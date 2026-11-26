/**
 * tells make --product: a product of several screens, built system first.
 *
 * Usage:
 *   tells make "<product brief>" --product --screens "<id>: <job>; <id>: <job>; …"
 *              [--reference <r>]... [--kind <k>] [--style] [--assets <dir>] [--variants 2] [--concurrency 3]
 *              [--out <dir>] [--agent "<cmd>"] [--model <id>] [--timeout <minutes>] [--dry-run]
 *   tells make --resume <out> --approve v1      continue from the system you chose
 *   tells make --resume <out>                   pick up a stopped run (failed screens run again)
 *   tells make --resume <out> --revise product --notes "…"   send the built product back with your notes
 *   tells make --product --from <dir> ["<brief>"] [--approved a,b] [--screens "…"]   take in an approved product
 *
 * 0. With --from, instead of 1–3: the product is copied, its screens found, its look baselined (screenshots, tokens,
 *    every check), and one agent writes down what exists without changing it (see src/ingest.mjs).
 * 1. System: each variant designs the whole product's system (tokens, parts, shell, store, one chart language),
 *    one world of sample facts, the shared-state contracts, and the first two screens. Then it stops: a person
 *    looks at the lead screens and approves one system. Taste is decided once, where it matters.
 * 2. Screens: one agent per remaining screen, in parallel, each in its own copy of the approved product. Only
 *    the files it owns come back (screens/<id>.*, data/<id>.js); what it needed from the system it writes down.
 * 3. Review: `tells consistent` across the screens, check, render and click, then one agent folds the needs into
 *    the system, fixes the drift, walks the contracts, and re-runs every check.
 * 4. Your notes, as many rounds as you like: `--revise product --notes "…"` sends the built product back to one
 *    agent, who fixes each note at its cause (usually the system, so every screen gets it), then every check runs again.
 *
 * State lives in <out>/product.json, so a run stopped by a limit picks up where it stopped.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { display, makePaint, parseArgs } from "./check.mjs";
import { resolveReferences } from "./references.mjs";
import { runAgent } from "./make.mjs";
import { intFlag } from "./cli.mjs";
import { copyProduct, discoverScreens, briefFrom, hasDarkTheme, readTokens, restoreExcept, INGEST_DOCS } from "./ingest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TELLS = path.resolve(HERE, "..");
const BIN = path.join(TELLS, "bin", "tells.mjs");
const MINUTES = { system: 50, screen: 35, review: 45, ingest: 30 };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "product";
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);

/** "today: what to roast and ship; orders: wholesale orders" (or a file of such lines) → [{id, job}] */
export function parseScreens(spec) {
  const text = spec && fs.existsSync(spec) && fs.statSync(spec).isFile() ? fs.readFileSync(spec, "utf8") : String(spec ?? "");
  const screens = text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^([a-z0-9][a-z0-9-]*)\s*:\s*(.+)$/i.exec(s);
      return m ? { id: m[1].toLowerCase(), job: m[2].trim() } : { id: slug(s).split("-").slice(0, 2).join("-"), job: s };
    });
  const ids = new Set();
  for (const s of screens) {
    if (ids.has(s.id)) throw new Error(`screen "${s.id}" is listed twice`);
    ids.add(s.id);
  }
  return screens;
}

const fill = (template, vars) => {
  let t = template;
  for (const [k, v] of Object.entries(vars)) t = t.replaceAll(`{{${k}}}`, v);
  return t.replace(/\n{3,}/g, "\n\n");
};
const read = (name) => fs.readFileSync(path.join(HERE, name), "utf8");
const screenList = (screens) => screens.map((s, i) => `- \`${s.id}\`${i < 2 ? " (lead)" : ""}: ${s.job}`).join("\n");

export function systemPrompts(state, n) {
  const { brief, screens, refs, style, assets } = state;
  const list = refs.map((r, i) => `- \`reference-${i + 1}.png\`: ${r.name}${r.url ? ` (${r.url})` : ""}${r.why ? `. Why it's good: ${r.why}` : ""}`).join("\n");
  return Array.from({ length: n }, (_, i) => {
    const main = (i % Math.max(1, refs.length)) + 1;
    const study = refs.length
      ? `Your main reference is \`reference-${main}.png\`${refs.length > 1 ? "; the other variants study the others" : ""}. Rebuild its first screen as \`study.html\` (inline CSS) as faithfully as you can, then \`node ${TELLS}/bin/tells.mjs measure study.html --shots shots\` and compare; two passes at most. Write \`STUDY.md\`: the decisions that make it good, measured: type steps in px and where each is used, row heights and anatomy, gutters, how many items the first screen holds, how big the biggest thing is next to body text, what's deliberately quiet, how status is marked, how colour is used. You are not copying its subject or layout: you are learning its finish, to put into the system.`
      : `There are no references. In \`STUDY.md\`, name two shipped products of this kind whose finish you're aiming for, and write down the measured decisions you'll take from them: type steps in px, row heights, gutters, density, how big the biggest thing is next to body text, how status and colour are used.`;
    return fill(read("make.system.md"), {
      k: String(i + 1),
      n: String(n),
      brief,
      screens: screenList(screens),
      references: refs.length ? `**References.** Shipped screens (1440×900) in this folder, made by teams that refined them against real use. They may be a different subject from yours:\n\n${list}` : "",
      assets: assets ? "**Assets.** `assets/` holds real files for this product: logos, photos, art. Use them." : "",
      study,
      palette: style
        ? "The look comes from the main reference: it was chosen for its style. Carry over its theme, palette, type families and weights, surfaces and lines, redrawn for this product. Don't copy its logo or wording."
        : "Choose the palette and theme (light or dark) from the product and where it's used, not from the reference, and say why in NOTES.md.",
      lead1: screens[0].id,
      lead2: screens[1].id,
      tells: TELLS,
    });
  });
}

export function screenPrompt(state, screen) {
  const { brief, screens } = state;
  return fill(read("make.screen.md"), {
    brief,
    id: screen.id,
    job: screen.job,
    others: screens.filter((s) => s.id !== screen.id).map((s) => `\`${s.id}\` (${s.job})`).join(", "),
    lead1: screens[0].id,
    lead2: screens[1].id,
    tells: TELLS,
  });
}

export function reviewPrompt(state) {
  return fill(read("make.review.md"), {
    brief: state.brief,
    screens: screenList(state.screens),
    lead1: state.screens[0].id,
    lead2: state.screens[1].id,
    tells: TELLS,
  });
}

/** Files a screen's agent owns; everything else in its copy is thrown away. */
export const owned = (id) => [`screens/${id}.html`, `screens/${id}.css`, `screens/${id}.js`, `screens/${id}.needs.md`, `screens/${id}.critique.md`, `data/${id}.js`];

const tells = (args, cwd) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ") };
  }
};

async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function copyTree(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name, e)) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else fs.copyFileSync(a, b);
  }
}

/** Checks one product folder: consistent across screens, check and render, as counts and hits. */
function audit(dir, state) {
  const targets = targetsOf(state);
  const leads = leadsOf(state).filter((f) => fs.existsSync(path.join(dir, f.split("#")[0])));
  const cons = tells(["consistent", ...targets, ...leads.flatMap((l) => ["--lead", l]), "--json"], dir);
  const chk = tells(["check", ".", "--json"], dir);
  const ren = tells(["render", ...targets, "--json", "--widths", "1440,390"], dir);
  const clk = tells(["click", ...targets, "--json"], dir);
  const count = (hits, sev) => (hits ?? []).filter((h) => h.severity === sev).length;
  return {
    consistent: { errors: count(cons.hits, "error"), warnings: count(cons.hits, "warn"), hits: cons.hits ?? [], system: cons.system ?? null, error: cons.error },
    check: { errors: count(chk.hits, "error"), warnings: count(chk.hits, "warn"), hits: chk.hits ?? [], error: chk.error },
    render: { errors: count(ren.hits, "error"), warnings: count(ren.hits, "warn"), hits: ren.hits ?? [], error: ren.error },
    click: { errors: count(clk.hits, "error"), warnings: count(clk.hits, "warn"), hits: clk.hits ?? [], error: clk.error },
  };
}

/**
 * An agent may declare the product's real shortcuts, but not grant itself project-wide exceptions:
 * any "allow" it wrote moves to .tellsrc.proposed for the person to decide. Returns what was set aside.
 */
export function quarantineAllow(dir) {
  const rc = path.join(dir, ".tellsrc");
  if (!fs.existsSync(rc)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(rc, "utf8"));
  } catch {
    fs.renameSync(rc, `${rc}.proposed`);
    return { invalid: true };
  }
  if (!raw.allow || !Object.keys(raw.allow).length) return null;
  fs.writeFileSync(`${rc}.proposed`, JSON.stringify({ allow: raw.allow }, null, 2) + "\n");
  const { allow, ...rest } = raw;
  if (Object.keys(rest).length) fs.writeFileSync(rc, JSON.stringify(rest, null, 2) + "\n");
  else fs.rmSync(rc);
  return allow;
}

export function revisePrompt(state, notes) {
  return fill(read("make.revise.md"), {
    brief: state.brief,
    notes: notes.trim().split("\n").map((l) => `> ${l}`).join("\n"),
    lead1: state.screens[0].id,
    lead2: state.screens[1].id,
    tells: TELLS,
  });
}

/** The built product sent back with a person's notes: one agent, every screen, causes fixed in the system. */
export function polishPrompt(state, notes, round = 1) {
  return fill(read("make.polish.md"), {
    round: String(round),
    brief: state.brief,
    screens: screenList(state.screens),
    notes: notes.trim().split("\n").map((l) => `> ${l}`).join("\n"),
    approved: state.origin === "from"
      ? "**This product was approved before you.** Read `APPROVED.md` and `PRODUCT.md` first, and keep every frozen decision unless a note names it: tokens, typefaces, the chart language, identity, the shell, the layout grid. Build the way `PRODUCT.md` says this product is built."
      : "",
    docs: (state.origin === "from" ? ["SYSTEM.md", "APPROVED.md", "PRODUCT.md", "CONTRACTS.md"] : ["SYSTEM.md", "CONTRACTS.md", "REVIEW.md"]).map((d) => `\`${d}\``).join(", "),
    // fix rewrites approved choices (it swaps pills for a radius), so a product taken in doesn't get a blanket one.
    fix: state.origin === "from" ? "" : `node ${TELLS}/bin/tells.mjs fix .\n`,
    targets: targetsOf(state).join(" "),
    leadArgs: leadsOf(state).map((l) => `--lead ${l}`).join(" "),
    tells: TELLS,
  });
}

/** What the checks load: the screens' pages, or the built routes of a product taken in with --from. */
export const targetsOf = (state) => (state.manifest ? state.manifest.filter((s) => s.built).map((s) => s.target) : ["screens"]);
/** The screens that define the system: the approved ones of a product taken in, else the two leads. */
export const leadsOf = (state) =>
  state.manifest
    ? state.manifest.filter((s) => s.built && (state.leads ?? []).includes(s.id)).map((s) => s.target)
    : state.screens.slice(0, 2).map((s) => `screens/${s.id}.html`);
/** The name `tells measure --shots` gives a target's screenshot. */
export const shotName = (target) => target.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(-80) + ".png";
const shotOf = (state, id) => (state.manifest ? shotName(state.manifest.find((s) => s.id === id)?.target ?? id) : `screens_${id}.html.png`);

/**
 * NOTES.jsonl, the ledger: one line for each note a person sent and each thing the agent found on the way, with
 * its kind (defect or decision), a tag for the kind of thing, and the tells rule that flags it, if one does.
 * Lines that don't parse are skipped.
 */
export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    try {
      const e = JSON.parse(l);
      return e && typeof e === "object" && typeof e.note === "string" ? [e] : [];
    } catch {
      return [];
    }
  });
}

/** One round of the ledger in counts: what the person had to say, split by kind, and what was found besides. */
export function tallyNotes(entries, round) {
  const inRound = entries.filter((e) => Number(e.round) === round);
  const person = inRound.filter((e) => e.from !== "found");
  return {
    defects: person.filter((e) => e.kind === "defect").length,
    decisions: person.filter((e) => e.kind === "decision").length,
    found: inRound.filter((e) => e.from === "found").length,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tallyLine = (t) => (t && t.defects + t.decisions + t.found ? ` · your notes: ${plural(t.defects, "defect")}, ${plural(t.decisions, "decision")}; found ${t.found} more` : "");

/** Agents run only node, so deletions they want come as DELETE.txt; only files inside the product go. */
function applyDeletions(product) {
  const list = path.join(product, "DELETE.txt");
  if (!fs.existsSync(list)) return [];
  const removed = [];
  for (const rel of fs.readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const abs = path.resolve(product, rel);
    if (abs.startsWith(product + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      fs.rmSync(abs);
      removed.push(rel);
    }
  }
  fs.rmSync(list);
  return removed;
}

/** A product taken in with --from: what came in, as it came, and each round of notes since. */
function writeFromReport(out, state) {
  const rounds = state.polishes ?? [];
  const shot = (s, theme) => `product/baseline/${theme}/${shotName(s.target)}`;
  fs.writeFileSync(
    path.join(out, "REPORT.md"),
    [
      `# ${state.brief}`,
      "",
      `Taken in from \`${display(state.source)}\`: ${state.manifest.length} screens, ${state.layout === "spa" ? `routes of \`${state.entry}\`` : "one page each"}. The source isn't touched; the copy is [product](product).`,
      "",
      `- As it came: ${state.baseline.line}`,
      ...(state.ingest?.reverted?.length ? [`- Put back after the describing agent changed them: ${state.ingest.reverted.map((r) => `\`${r.file}\` (${r.was})`).join(", ")}`] : []),
      ...rounds.map((r, i) => `- After your notes, round ${i + 1}: ${r.after}${tallyLine(r.ledger)}${r.run.ok ? "" : ` (agent stopped: ${r.run.error})`}`),
      "",
      `| Screen | Job | Approved | As it came${state.baseline.dark ? " | Dark" : ""} |`,
      `|---|---|---|---${state.baseline.dark ? "|---" : ""}|`,
      ...state.manifest.map((s) =>
        s.built
          ? `| [${s.id}](product/${s.target}) | ${s.job} | ${(state.leads ?? []).includes(s.id) ? "yes" : ""} | ![${s.id}](${shot(s, "light")}) |${state.baseline.dark ? ` ![${s.id} dark](${shot(s, "dark")}) |` : ""}`
          : `| ${s.id} | ${s.job} | not built yet | |${state.baseline.dark ? " |" : ""}`,
      ),
      "",
      `The product as found: [SYSTEM.md](product/SYSTEM.md), [APPROVED.md](product/APPROVED.md), [PRODUCT.md](product/PRODUCT.md), [CONTRACTS.md](product/CONTRACTS.md).${rounds.length ? " What your notes changed: [POLISH.md](product/POLISH.md), and what kind each was: [NOTES.jsonl](product/NOTES.jsonl)." : ""}`,
      "",
      `Send it notes: \`tells make --resume ${display(out)} --revise product --notes "<what to change>"\``,
      "",
    ].join("\n"),
  );
}

function writeReport(out, state) {
  if (state.origin === "from") return writeFromReport(out, state);
  const rounds = state.polishes ?? [];
  fs.writeFileSync(
    path.join(out, "REPORT.md"),
    [
      `# ${state.brief}`,
      "",
      `Built on ${state.approved}'s system: [product/screens](product/screens). Start at [${state.screens[0].id}](product/screens/${state.screens[0].id}.html).`,
      "",
      `- Before review: ${state.result.before}`,
      `- After review: ${state.result.after}`,
      ...rounds.map((r, i) => `- After your notes, round ${i + 1}: ${r.after}${tallyLine(r.ledger)}${r.run.ok ? "" : ` (agent stopped: ${r.run.error})`}`),
      "",
      "| Screen | Job | Screenshot |",
      "|---|---|---|",
      ...state.screens.map((s) => `| [${s.id}](product/screens/${s.id}.html) | ${s.job} | ![${s.id}](product/shots/screens_${s.id}.html.png) |`),
      "",
      `What the review changed: [REVIEW.md](product/REVIEW.md).${rounds.length ? " What your notes changed: [POLISH.md](product/POLISH.md), and what kind each was: [NOTES.jsonl](product/NOTES.jsonl)." : ""} The system: [SYSTEM.md](product/SYSTEM.md), [CONTRACTS.md](product/CONTRACTS.md).`,
      "",
      `Send it back with notes: \`tells make --resume ${display(out)} --revise product --notes "<what to change>"\``,
      "",
    ].join("\n"),
  );
}

const line = (a) => `consistent ${a.consistent.errors}E/${a.consistent.warnings}W · check ${a.check.errors}E/${a.check.warnings}W · render ${a.render.errors}E/${a.render.warnings}W${a.click ? ` · click ${a.click.errors}E/${a.click.warnings}W` : ""}`;

/** Re-check each variant's lead screens and write CHECKPOINT.md for the person to pick from. */
function checkpoint(out, state, variants, { say, paint, only = null }) {
  const rows = [];
  for (const v of variants) {
    const d = path.join(out, v);
    if (!only || only === v || !state.audits?.[v]) {
      const set = quarantineAllow(d);
      if (set) state.proposed = { ...(state.proposed ?? {}), [v]: set };
      spawnSync(process.execPath, [BIN, "fix", "."], { cwd: d, stdio: "ignore" });
      tells(["measure", ...state.screens.slice(0, 2).map((s) => `screens/${s.id}.html`), "--shots", "shots", "--json"], d);
      state.audits = { ...(state.audits ?? {}), [v]: line(audit(d, state)) };
    }
    rows.push({ v, line: state.audits?.[v] ?? "" });
  }
  save(out, state);
  const shot = (v, id) => `${v}/shots/screens_${id}.html.png`;
  const proposed = (v) => state.proposed?.[v] ? [`Set aside: this variant tried to allow ${Object.keys(state.proposed[v]).join(", ")} project-wide (see ${v}/.tellsrc.proposed). It isn't applied unless you move it into .tellsrc.`, ""] : [];
  const revised = (v) => (state.revisions ?? []).filter((r) => r.v === v).length;
  fs.writeFileSync(
    path.join(out, "CHECKPOINT.md"),
    [
      `# ${state.brief}`,
      "",
      "Pick the system. Look at each variant's two lead screens; the rest of the product will be built on the one you approve. Send notes on one first with --revise.",
      "",
      ...rows.flatMap(({ v, line: l }) => [
        `## ${v}${revised(v) ? ` (revised ${revised(v)}×, see ${v}/REVISION.md)` : ""}`,
        "",
        ...state.screens.slice(0, 2).map((s) => `![${v} ${s.id}](${shot(v, s.id)})`),
        "",
        `${l}. [NOTES](${v}/NOTES.md), [SYSTEM](${v}/SYSTEM.md), [CONTRACTS](${v}/CONTRACTS.md)`,
        "",
        ...proposed(v),
      ]),
      `Approve: \`tells make --resume ${display(out)} --approve <v>\``,
      `Or revise first: \`tells make --resume ${display(out)} --revise <v> --notes "<what to change>"\``,
      "",
    ].join("\n"),
  );
  say("");
  for (const { v, line: l } of rows) {
    say(`${paint.bold(v)}  ${paint.dim(l)}`);
    for (const s of state.screens.slice(0, 2)) say(`  ${display(path.join(out, shot(v, s.id)))}`);
    if (state.proposed?.[v]) say(paint.yellow(`  set aside: allow ${Object.keys(state.proposed[v]).join(", ")} (${v}/.tellsrc.proposed)`));
  }
  say(`\n${paint.bold("Your turn.")} Look at the lead screens (${display(path.join(out, "CHECKPOINT.md"))}), then:`);
  say(`  tells make --resume ${display(out)} --approve ${rows[0].v}`);
  say(paint.dim(`  or: tells make --resume ${display(out)} --revise ${rows[0].v} --notes "<what to change>"`));
}

/** One hit, without what moves when the code is edited (check's line numbers), so a baseline hit is known again. */
export const hitSignature = (tool, h) => [tool, h.rule, h.target ?? h.file ?? "", tool === "check" ? "" : h.detail ?? ""].join(" ");

/**
 * tells make --product --from <dir>: copy the product (the source is never written to), find its screens, and set
 * the run up at the ingest stage. The brief is optional: the entry page's <title>, else the folder's name.
 */
async function startFrom({ valueOf, positional, flags }) {
  const fail = (msg) => {
    console.error(`tells make --from: ${msg}`);
    process.exit(2);
  };
  const source = path.resolve(valueOf("from"));
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) fail(`${display(source)} isn't a folder.`);
  let found;
  try {
    found = await discoverScreens(source);
  } catch (err) {
    fail(err.message);
  }
  const manifest = found.screens;
  const values = new Set([valueOf("from"), valueOf("screens"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("timeout"), valueOf("approved")].filter(Boolean));
  const brief = positional.filter((p) => !values.has(p)).join(" ").trim() || briefFrom(source, found.entry);
  let screens = manifest.filter((s) => s.built).map(({ id, job }) => ({ id, job }));
  if (valueOf("screens")) {
    let listed = [];
    try {
      listed = parseScreens(valueOf("screens"));
    } catch (err) {
      fail(err.message);
    }
    const unknown = listed.filter((l) => !manifest.some((m) => m.id === l.id));
    if (unknown.length) fail(`no screen called ${unknown.map((u) => `"${u.id}"`).join(", ")} in ${display(source)}. It has: ${manifest.map((m) => m.id).join(", ")}.`);
    for (const l of listed) manifest.find((m) => m.id === l.id).job = l.job;
    screens = listed;
  }
  const leads = valueOf("approved") ? valueOf("approved").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : screens.map((s) => s.id);
  const notThere = leads.filter((id) => !manifest.some((m) => m.id === id && m.built));
  if (notThere.length) fail(`--approved names ${notThere.map((x) => `"${x}"`).join(", ")}, which isn't a built screen. Built: ${manifest.filter((m) => m.built).map((m) => m.id).join(", ")}.`);
  const out = path.resolve(valueOf("out") ?? path.join("tells-make", `${slug(brief)}-${stamp()}`));
  if (out === source || out.startsWith(source + path.sep)) fail(`--out can't be inside the product it copies (${display(source)}).`);
  if (fs.existsSync(path.join(out, "product.json"))) fail(`${display(out)} already holds a run. Continue it with --resume ${display(out)}.`);
  const product = path.join(out, "product");
  const skipped = copyProduct(source, product);
  fs.writeFileSync(path.join(product, "screens.json"), JSON.stringify(manifest, null, 2) + "\n");
  // The product as it came: what the describing agent's changes are put back to.
  copyProduct(product, path.join(out, "rounds", "0"));
  const state = {
    origin: "from", source, layout: found.layout, entry: found.entry, brief, screens, manifest, leads, skipped,
    stage: "ingest", approved: null, built: {}, runs: {}, started: new Date().toISOString(),
  };
  if (flags["dry-run"]) state.dryRun = true;
  save(out, state);
  return { out, state };
}

function save(out, state) {
  fs.writeFileSync(path.join(out, "product.json"), JSON.stringify(state, null, 2) + "\n");
}

export async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const valueOf = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : typeof flags[name] === "string" ? flags[name] : null;
  };
  const many = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--") ? [argv[i + 1]] : []));
  const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const say = (s) => process.stdout.write(s + "\n");
  const agent = valueOf("agent");
  const model = valueOf("model");
  const concurrency = intFlag("concurrency", valueOf("concurrency"), { min: 1, max: 8, fallback: 3 });
  const minutes = intFlag("timeout", valueOf("timeout"), { min: 1, max: 600, fallback: null });
  const variantCount = intFlag("variants", valueOf("variants"), { min: 1, max: 4, fallback: 2 });

  const resume = valueOf("resume");
  let out;
  let state;
  if (resume) {
    out = path.resolve(resume);
    try {
      state = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
    } catch {
      console.error(`tells make: ${display(out)} has no product.json; is it a --product run?`);
      process.exit(2);
    }
  } else if (valueOf("from")) {
    ({ out, state } = await startFrom({ valueOf, positional, flags }));
  } else {
    const values = new Set([valueOf("screens"), valueOf("variants"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("timeout"), valueOf("assets"), valueOf("concurrency"), valueOf("notes"), ...many("reference"), ...many("kind")].filter(Boolean));
    const brief = positional.filter((p) => !values.has(p)).join(" ").trim();
    if (!brief) {
      console.error('tells make --product: give it a brief, e.g. tells make "a coffee roaster\'s back office" --product --screens "today: …; orders: …"');
      process.exit(2);
    }
    let screens;
    try {
      screens = parseScreens(valueOf("screens"));
    } catch (err) {
      console.error(`tells make --product: ${err.message}`);
      process.exit(2);
    }
    if (screens.length < 3) {
      console.error('tells make --product: list at least three screens with --screens "<id>: <job>; …". The first two are the lead screens you approve.');
      process.exit(2);
    }
    out = path.resolve(valueOf("out") ?? path.join("tells-make", `${slug(brief)}-${stamp()}`));
    const assets = valueOf("assets") ? path.resolve(valueOf("assets")) : null;
    let refs = [];
    if (many("reference").length || many("kind").length) {
      try {
        refs = await resolveReferences({ specs: many("reference"), kinds: many("kind"), dir: path.join(out, "references") });
      } catch (err) {
        console.error(`tells make: ${err.message}`);
        process.exit(2);
      }
    }
    const variants = variantCount;
    state = {
      brief, screens, style: Boolean(flags.style), assets, variants,
      refs: refs.map((r) => ({ name: r.name, url: r.url ?? null, why: r.why ?? null, png: r.png })),
      stage: "system", approved: null, built: {}, runs: {}, started: new Date().toISOString(),
    };
    fs.mkdirSync(out, { recursive: true });
    save(out, state);
  }

  const timeoutFor = (kind) => (minutes ?? MINUTES[kind]) * 60_000;

  // ---- 0. Taken in with --from: baseline everything, then one agent writes it down, changing nothing --------
  if (state.stage === "ingest") {
    const product = path.join(out, "product");
    const targets = targetsOf(state);
    const prompt = fill(read("make.ingest.md"), {
      brief: state.brief,
      layout: state.layout === "spa" ? `routes of the single-page app \`${state.entry}\`` : "one page each",
      screens: state.manifest.map((s) => `- \`${s.id}\`: ${s.job}. \`${s.target}\`${s.built ? "" : " (not built yet)"}${s.inShell ? ", drawn by the shell" : s.files.length ? `, files: ${s.files.map((f) => `\`${f}\``).join(", ")}` : ""}`).join("\n"),
      dark: state.baseline?.dark || hasDarkTheme(product) ? " and `baseline/dark/`" : "",
      targets: targets.join(" "),
      tells: TELLS,
    });
    fs.writeFileSync(path.join(out, "INGEST-PROMPT.md"), prompt);
    say(`${paint.bold("tells make --product --from")}  ${state.brief}`);
    say(paint.dim(`${state.manifest.length} screens (${state.manifest.map((s) => s.id + (s.built ? "" : " (not built)")).join(", ")}), approved: ${(state.leads ?? []).join(", ")}`));
    if (flags["dry-run"]) {
      say(`Copied to ${display(product)} and wrote the ingest prompt to ${display(out)}. Run without --dry-run to take it in.`);
      return;
    }
    if (!state.baseline) {
      say(`${paint.bold("Baseline")}  screenshots, tokens and every check, as it came`);
      const dark = hasDarkTheme(product);
      tells(["measure", ...targets, "--shots", "baseline/light", "--full", "--json"], product);
      if (dark) tells(["measure", ...targets, "--shots", "baseline/dark", "--full", "--theme", "dark", "--json"], product);
      const a = audit(product, state);
      state.baseline = {
        dark,
        tokens: readTokens(product),
        system: a.consistent.system,
        // The client's own hits: only new ones count against a round.
        hits: ["consistent", "check", "render", "click"].flatMap((tool) => a[tool].hits.map((h) => hitSignature(tool, h))),
        line: line(a),
      };
      save(out, state);
      say(`  ${paint.dim(state.baseline.line)}`);
    }
    say(`${paint.bold("Describing")} the product: SYSTEM, CONTRACTS, APPROVED and PRODUCT, changing nothing`);
    const r = await runAgent({ dir: product, prompt, agent, model, timeoutMs: timeoutFor("ingest") });
    say(`  ${r.ok ? paint.green("described") : paint.yellow(r.error)}  ${r.seconds}s`);
    // Anything but the four documents goes back to how it came.
    const reverted = restoreExcept(product, path.join(out, "rounds", "0"), (f) => INGEST_DOCS.includes(f) || f === "agent.log");
    const missing = INGEST_DOCS.filter((f) => !fs.existsSync(path.join(product, f)));
    state.ingest = { run: r, reverted, missing };
    if (reverted.length) say(paint.yellow(`  put back: ${reverted.map((x) => `${x.file} (${x.was})`).join(", ")}`));
    if (missing.length) say(paint.yellow(`  not written: ${missing.join(", ")}`));
    state.stage = "done";
    save(out, state);
    writeReport(out, state);
    say(`${paint.bold("Taken in.")} ${display(path.join(out, "REPORT.md"))}`);
    say(paint.dim(`Send it notes: tells make --resume ${display(out)} --revise product --notes "<what to change>"`));
    if (!r.ok || missing.length) process.exitCode = 1;
    return;
  }

  // ---- 1. System -------------------------------------------------------------------------------------------
  if (state.stage === "system") {
    const texts = systemPrompts(state, state.variants);
    const dirs = texts.map((_, i) => path.join(out, `v${i + 1}`));
    for (const [i, dir] of dirs.entries()) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "PROMPT.md"), texts[i]);
      state.refs.forEach((r, j) => fs.copyFileSync(r.png, path.join(dir, `reference-${j + 1}.png`)));
      if (state.assets) fs.cpSync(state.assets, path.join(dir, "assets"), { recursive: true });
    }
    const agents = state.variants + state.screens.length - 2 + 1;
    say(`${paint.bold("tells make --product")}  ${state.brief}`);
    say(paint.dim(`${state.screens.length} screens (${state.screens.map((s) => s.id).join(", ")}); leads ${state.screens[0].id} and ${state.screens[1].id}`));
    say(paint.dim(`Run: ${state.variants} system variants now, then ${state.screens.length - 2} screen agents and 1 review after you approve: ${agents} agent runs, about ${MINUTES.system} + ${Math.ceil((state.screens.length - 2) / concurrency) * MINUTES.screen} + ${MINUTES.review} minutes at most.`));
    if (flags["dry-run"]) {
      say(`Wrote ${state.variants} system prompts to ${display(out)}. Run without --dry-run to build them.`);
      return;
    }
    if (!agent && spawnSync("claude", ["--version"], { encoding: "utf8" }).error) {
      console.error("tells make: Claude Code (`claude`) isn't on your PATH. Install it, or pass --agent.");
      process.exit(2);
    }
    await Promise.all(
      dirs.map(async (dir, i) => {
        const v = `v${i + 1}`;
        if (state.runs[v]?.ok && fs.existsSync(path.join(dir, "screens", `${state.screens[0].id}.html`))) return;
        const r = await runAgent({ dir, prompt: texts[i], agent, model, timeoutMs: timeoutFor("system") });
        state.runs[v] = r;
        save(out, state);
        const made = state.screens.slice(0, 2).every((s) => fs.existsSync(path.join(dir, "screens", `${s.id}.html`)));
        say(`  ${v}  ${made ? paint.green("system built") : paint.red("lead screens missing")}  ${r.seconds}s${r.error ? paint.yellow(`  ${r.error}`) : ""}`);
      }),
    );
    const built = dirs.filter((d) => state.screens.slice(0, 2).every((s) => fs.existsSync(path.join(d, "screens", `${s.id}.html`))));
    if (!built.length) {
      console.error(`tells make: no variant built the lead screens. See agent.log in ${display(out)}; run again with --resume ${display(out)}.`);
      process.exitCode = 1;
      return;
    }
    for (const d of built) {
      if (fs.existsSync(path.join(d, "study.html"))) {
        fs.mkdirSync(path.join(d, "shots"), { recursive: true });
        fs.renameSync(path.join(d, "study.html"), path.join(d, "shots", "study.html"));
      }
    }
    state.stage = "checkpoint";
    save(out, state);
    checkpoint(out, state, built.map((d) => path.basename(d)), { say, paint });
    return;
  }

  // ---- Checkpoint: revise a system with the person's notes, then stop again -----------------------------
  if (state.stage === "checkpoint" && valueOf("revise")) {
    const v = valueOf("revise");
    const dir = path.join(out, v);
    const notesArg = valueOf("notes");
    const notes = notesArg && fs.existsSync(notesArg) ? fs.readFileSync(notesArg, "utf8") : notesArg;
    if (!fs.existsSync(path.join(dir, "SYSTEM.md")) || !notes) {
      console.error(`tells make: --revise <v> needs a built variant and --notes "<what to change>" (or a notes file).`);
      process.exit(2);
    }
    const prompt = revisePrompt(state, notes);
    const n = (state.revisions ?? []).filter((r) => r.v === v).length + 1;
    fs.writeFileSync(path.join(dir, `REVISE-${n}.md`), prompt);
    say(`${paint.bold("Revising")} ${v} with your notes`);
    const r = await runAgent({ dir, prompt, agent, model, timeoutMs: timeoutFor("system") });
    state.revisions = [...(state.revisions ?? []), { v, notes, run: r }];
    save(out, state);
    say(`  ${v}  ${r.ok ? paint.green("revised") : paint.yellow(r.error)}  ${r.seconds}s`);
    const variants = fs.readdirSync(out).filter((n) => /^v\d+$/.test(n) && fs.existsSync(path.join(out, n, "SYSTEM.md")));
    checkpoint(out, state, variants, { say, paint, only: v });
    return;
  }


  // ---- 2. Screens ------------------------------------------------------------------------------------------
  const product = path.join(out, "product");
  if (state.stage === "checkpoint") {
    const v = valueOf("approve");
    if (!v || !fs.existsSync(path.join(out, v, "SYSTEM.md"))) {
      say(`Waiting for your pick. Look at ${display(path.join(out, "CHECKPOINT.md"))}, then: tells make --resume ${display(out)} --approve <v>`);
      return;
    }
    copyTree(path.join(out, v), product, (name) => ["shots", "agent.log", "PROMPT.md", "study.html", ".tellsrc.proposed"].includes(name) || /^reference-\d+\.png$|^REVISE-\d+\.md$/.test(name));
    fs.mkdirSync(path.join(product, "system-shots"), { recursive: true });
    for (const s of state.screens.slice(0, 2)) {
      const png = path.join(out, v, "shots", `screens_${s.id}.html.png`);
      if (fs.existsSync(png)) fs.copyFileSync(png, path.join(product, "system-shots", `${s.id}.png`));
    }
    state.approved = v;
    state.stage = "screens";
    for (const s of state.screens.slice(0, 2)) state.built[s.id] = "lead";
    save(out, state);
  }

  if (state.stage === "screens") {
    const todo = state.screens.slice(2).filter((s) => state.built[s.id] !== "built");
    say(`${paint.bold("tells make --product")}  building ${todo.length} screen${todo.length === 1 ? "" : "s"} on ${state.approved}'s system, ${concurrency} at a time`);
    await pool(todo, concurrency, async (s) => {
      const work = path.join(out, "work", s.id);
      fs.rmSync(work, { recursive: true, force: true });
      copyTree(product, work, (name) => name === "work");
      const prompt = screenPrompt(state, s);
      fs.writeFileSync(path.join(work, "PROMPT.md"), prompt);
      const r = await runAgent({ dir: work, prompt, agent, model, timeoutMs: timeoutFor("screen") });
      let got = 0;
      for (const f of owned(s.id)) {
        if (fs.existsSync(path.join(work, f))) {
          fs.mkdirSync(path.dirname(path.join(product, f)), { recursive: true });
          fs.copyFileSync(path.join(work, f), path.join(product, f));
          got++;
        }
      }
      const ok = fs.existsSync(path.join(product, "screens", `${s.id}.html`));
      state.built[s.id] = ok ? "built" : "failed";
      state.runs[s.id] = r;
      save(out, state);
      say(`  ${s.id.padEnd(14)} ${ok ? paint.green("built") : paint.red("failed")}  ${got} files, ${r.seconds}s${r.error ? paint.yellow(`  ${r.error}`) : ""}`);
    });
    const failed = state.screens.filter((s) => state.built[s.id] === "failed").map((s) => s.id);
    if (failed.length) {
      say(paint.yellow(`\n${failed.join(", ")} didn't build. Run again to retry them: tells make --resume ${display(out)}`));
      process.exitCode = 1;
      return;
    }
    state.stage = "review";
    save(out, state);
  }

  // ---- 3. Review -------------------------------------------------------------------------------------------
  if (state.stage === "review") {
    spawnSync(process.execPath, [BIN, "fix", "."], { cwd: product, stdio: "ignore" });
    tells(["measure", "screens", "--shots", "shots", "--json"], product);
    const before = audit(product, state);
    const needs = state.screens
      .map((s) => [s.id, path.join(product, "screens", `${s.id}.needs.md`)])
      .filter(([, f]) => fs.existsSync(f))
      .map(([id, f]) => `### ${id}\n\n${fs.readFileSync(f, "utf8").trim()}`);
    const hitLines = (a, key) => a[key].hits.map((h) => `- ${h.target ?? h.file}${h.line ? `:${h.line}` : ""} \`${h.rule}\` ${h.detail ?? h.snippet ?? ""}`);
    const section = (title, items, none = "Nothing.") => [`## ${title}`, "", ...(items.length ? items : [none]), ""];
    fs.writeFileSync(
      path.join(product, "REVIEW-INPUT.md"),
      [
        "# Review input",
        "",
        `Before review: ${line(before)}`,
        "",
        ...section("tells consistent", hitLines(before, "consistent")),
        ...section("tells check", hitLines(before, "check")),
        ...section("tells render", hitLines(before, "render")),
        ...section("tells click", hitLines(before, "click")),
        ...section("Needs from the screen builders", needs, "None."),
      ].join("\n"),
    );
    const prompt = reviewPrompt(state);
    fs.writeFileSync(path.join(product, "PROMPT.md"), prompt);
    say(`${paint.bold("Review")}  ${paint.dim(line(before))}`);
    if (!state.runs.review?.ok) {
      const r = await runAgent({ dir: product, prompt, agent, model, timeoutMs: timeoutFor("review") });
      state.runs.review = r;
      save(out, state);
      if (!r.ok) {
        say(paint.yellow(`Review stopped: ${r.error}. Run again to retry: tells make --resume ${display(out)}`));
        process.exitCode = 1;
        return;
      }
    }
    const removed = applyDeletions(product);
    if (removed.length) state.deleted = removed;
    const setAside = quarantineAllow(product);
    if (setAside) state.proposed = { ...(state.proposed ?? {}), review: setAside };
    tells(["measure", "screens", "--shots", "shots", "--json"], product);
    const after = audit(product, state);
    state.stage = "done";
    state.finished = new Date().toISOString();
    state.result = { before: line(before), after: line(after) };
    save(out, state);
    writeReport(out, state);
    say(`${paint.bold("Done")}  ${paint.dim(line(after))}`);
    say(`Start at ${display(path.join(product, "screens", `${state.screens[0].id}.html`))}`);
    say(paint.dim(`Report: ${display(path.join(out, "REPORT.md"))}`));
    if (after.consistent.errors || after.check.errors || after.render.errors) process.exitCode = 1;
    return;
  }

  // ---- 4. Your notes on the built product: one agent, every screen, then every check again ----------------
  if (state.stage === "done" && valueOf("revise")) {
    const notesArg = valueOf("notes");
    const notes = notesArg && fs.existsSync(notesArg) ? fs.readFileSync(notesArg, "utf8") : notesArg;
    if (valueOf("revise") !== "product" || !notes) {
      console.error('tells make: the product is built. Send it back with --revise product --notes "<what to change>" (or a notes file).');
      process.exit(2);
    }
    const n = (state.polishes ?? []).length + 1;
    const prompt = polishPrompt(state, notes, n);
    fs.writeFileSync(path.join(out, `POLISH-PROMPT-${n}.md`), prompt);
    say(`${paint.bold("Polishing")} the product with your notes, round ${n}`);
    const r = await runAgent({ dir: product, prompt, agent, model, timeoutMs: timeoutFor("review") });
    say(`  ${r.ok ? paint.green("polished") : paint.yellow(r.error)}  ${r.seconds}s`);
    const removed = applyDeletions(product);
    const setAside = quarantineAllow(product);
    if (setAside) state.proposed = { ...(state.proposed ?? {}), [`polish-${n}`]: setAside };
    tells(["measure", ...targetsOf(state), "--shots", "shots", "--json"], product);
    const after = audit(product, state);
    const ledger = tallyNotes(readLedger(path.join(product, "NOTES.jsonl")), n);
    state.polishes = [...(state.polishes ?? []), { notes, run: r, deleted: removed, after: line(after), ledger, at: new Date().toISOString() }];
    save(out, state);
    writeReport(out, state);
    say(`${paint.bold("Done")}  ${paint.dim(line(after) + tallyLine(ledger))}`);
    for (const s of state.screens) say(`  ${display(path.join(product, "shots", shotOf(state, s.id)))}`);
    if (setAside) say(paint.yellow(`  set aside: allow ${Object.keys(setAside).join(", ")} (product/.tellsrc.proposed)`));
    say(paint.dim(`What changed: ${display(path.join(product, "POLISH.md"))}. Again: tells make --resume ${display(out)} --revise product --notes "<what to change>"`));
    if (!r.ok || after.consistent.errors || after.check.errors || after.render.errors || after.click?.errors) process.exitCode = 1;
    return;
  }

  if (state.stage === "done") say(`Already done. Report: ${display(path.join(out, "REPORT.md"))}. Send it back with notes: tells make --resume ${display(out)} --revise product --notes "<what to change>"`);
}
