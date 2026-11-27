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
import { costLine, runAgent } from "./make.mjs";
import { intFlag } from "./cli.mjs";
import { parseWidths } from "./render.mjs";
import { copyProduct, discoverScreens, briefFrom, hasDarkTheme, readTokens, restoreExcept, INGEST_DOCS } from "./ingest.mjs";
import { listedTokens, roundText, tokenViolations, traitViolations, newHits, diffShots } from "./guard.mjs";

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

/** The widths a folder's own .tellsrc names, or null. */
function widthsOf(dir) {
  try {
    const w = JSON.parse(fs.readFileSync(path.join(dir, ".tellsrc"), "utf8")).widths;
    return Array.isArray(w) && w.length ? w : null;
  } catch {
    return null;
  }
}

/**
 * Writes the widths the product is for into a folder's .tellsrc, keeping what else is there, so the agents' own
 * `render --strict` runs check the same widths the pipeline does. Called again after each agent, which may rewrite it.
 */
export function writeWidths(dir, widths) {
  if (!widths?.length || !fs.existsSync(dir)) return;
  const rc = path.join(dir, ".tellsrc");
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(rc, "utf8"));
  } catch {
    if (fs.existsSync(rc)) return; // not JSON: quarantineAllow sets it aside; don't write over it
  }
  if (JSON.stringify(raw.widths) === JSON.stringify(widths)) return;
  fs.writeFileSync(rc, JSON.stringify({ ...raw, widths }, null, 2) + "\n");
}

// What a screen agent doesn't need from the product: the lead stage's working notes, logs and screenshots.
// It reads SYSTEM.md, CONTRACTS.md, NOTES.md, system/, data/, screens/ and system-shots/.
const NOT_FOR_SCREENS = new Set(["work", "CRITIQUE.md", "REVISION.md", "STUDY.md", "REVIEW-INPUT.md", "REVIEW.md", "POLISH.md", "FIXES.md", "PROMPT.md", "agent.log", "agent.jsonl", "shots", "rounds", "baseline"]);

/** Checks one product folder: consistent across screens, check and render, as counts and hits. */
function audit(dir, state) {
  const targets = targetsOf(state);
  const leads = leadsOf(state).filter((f) => fs.existsSync(path.join(dir, f.split("#")[0])));
  const cons = tells(["consistent", ...targets, ...leads.flatMap((l) => ["--lead", l]), "--json"], dir);
  const chk = tells(["check", ".", "--json"], dir);
  // The widths the product's .tellsrc says it's for, else a laptop and a phone.
  const ren = tells(["render", ...targets, "--json", ...(widthsOf(dir) ? [] : ["--widths", "1440,390"])], dir);
  const clk = tells(["click", ...targets, "--json"], dir);
  const count = (hits, sev) => (hits ?? []).filter((h) => h.severity === sev).length;
  return {
    consistent: { errors: count(cons.hits, "error"), warnings: count(cons.hits, "warn"), hits: cons.hits ?? [], system: cons.system ?? null, screens: cons.screens ?? [], error: cons.error },
    check: { errors: count(chk.hits, "error"), warnings: count(chk.hits, "warn"), hits: chk.hits ?? [], error: chk.error },
    render: { errors: count(ren.hits, "error"), warnings: count(ren.hits, "warn"), hits: ren.hits ?? [], error: ren.error },
    click: { errors: count(clk.hits, "error"), warnings: count(clk.hits, "warn"), hits: clk.hits ?? [], error: clk.error },
  };
}

/**
 * An agent may declare the product's real shortcuts, but not grant itself project-wide exceptions:
 * any "allow" it wrote moves to .tellsrc.proposed for the person to decide. Returns what was set aside.
 */
export function quarantineAllow(dir, keep = {}) {
  const rc = path.join(dir, ".tellsrc");
  if (!fs.existsSync(rc)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(rc, "utf8"));
  } catch {
    fs.renameSync(rc, `${rc}.proposed`);
    return { invalid: true };
  }
  // Only what the agent added: exceptions already there (the person's, or the pipeline's) stay.
  const added = Object.fromEntries(Object.entries(raw.allow ?? {}).filter(([k, v]) => keep[k] !== v));
  if (!Object.keys(added).length) return null;
  fs.writeFileSync(`${rc}.proposed`, JSON.stringify({ allow: added }, null, 2) + "\n");
  const kept = Object.fromEntries(Object.entries(raw.allow).filter(([k]) => !(k in added)));
  const { allow, ...rest } = raw;
  const next = Object.keys(kept).length ? { ...rest, allow: kept } : rest;
  if (Object.keys(next).length) fs.writeFileSync(rc, JSON.stringify(next, null, 2) + "\n");
  else fs.rmSync(rc);
  return added;
}

/** The exceptions a product's .tellsrc grants now, so a round can tell which ones it added. */
function readAllow(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".tellsrc"), "utf8")).allow ?? {};
  } catch {
    return {};
  }
}

/**
 * What a round changed that the notes didn't ask for. Blocking: a token changed and not listed under "Tokens changed"
 * in the round's write-up; on a one-screen round, another screen whose typeface, headings, page, panel, marks or shell
 * drifted from how it came. Traits on a whole-product round are reported, not blocking: its notes may be about all of it.
 */
function runGuard(product, state, n, tokensBefore, allowed, blockTraits) {
  const log = fs.existsSync(path.join(product, "POLISH.md")) ? fs.readFileSync(path.join(product, "POLISH.md"), "utf8") : "";
  const tokens = tokenViolations(tokensBefore, readTokens(product), listedTokens(roundText(log, n)));
  const now = tells(["consistent", ...targetsOf(state), "--json"], product).screens ?? [];
  const traits = traitViolations(state.baseline.screens ?? [], now, allowed);
  const blocking = [
    ...tokens.map((t) => ({ what: `${t.token} in ${t.selector}: ${t.was ?? "(none)"} → ${t.now ?? "(removed)"}` })),
    ...(blockTraits ? traits.map((t) => ({ what: `${t.target}: ${t.rule} ${t.detail}` })) : []),
  ];
  return { tokens, traits, blocking };
}

function guardText(guard, n) {
  const pct = (x) => (x === null ? "no screenshot" : `${(x * 100).toFixed(1)}% of pixels`);
  return [
    `# Round ${n}: what changed that the notes didn't ask for`,
    "",
    "## Tokens",
    "",
    ...(guard.tokens.length ? guard.tokens.map((t) => `- \`${t.token}\` in \`${t.selector}\`: ${t.was ?? "(none)"} → ${t.now ?? "(removed)"}, not listed under "Tokens changed"`) : ["None."]),
    "",
    "## Other screens' traits, against how the product came in",
    "",
    ...(guard.traits.length ? guard.traits.map((t) => `- ${t.target}: ${t.rule} ${t.detail}`) : ["None."]),
    ...(guard.shots
      ? ["", "## Screenshots, against the round before", "", ...guard.shots.map((x) => `- ${x.id}: ${pct(x.changed)}${x.changed > 0.005 ? ` (before: ${x.before}, after: ${x.after})` : ""}`)]
      : []),
    "",
  ].join("\n");
}

/** Each built screen's screenshot against the round before (or the baseline): the share of its pixels that changed. */
async function shotChanges(out, state, n) {
  const product = path.join(out, "product");
  const prev = (x) => {
    for (let k = n - 1; k >= 1; k--) {
      const f = path.join(out, "rounds", String(k), "shots", shotName(x.target));
      if (fs.existsSync(f)) return f;
    }
    return path.join(product, "baseline", "light", shotName(x.target));
  };
  const built = state.manifest.filter((x) => x.built);
  const pairs = built.map((x) => [prev(x), path.join(out, "rounds", String(n), "shots", shotName(x.target))]);
  const changed = await diffShots(pairs);
  return built.map((x, i) => ({ id: x.id, changed: changed[i], before: path.relative(out, pairs[i][0]), after: path.relative(out, pairs[i][1]) }));
}

/** The built product sent back with a person's notes: one agent, every screen, causes fixed in the system. */

const TOOLS = ["consistent", "check", "render", "click"];

/** The errors one audit found, a line each, for the fix agent and CHECKPOINT.md. Warnings aren't listed. */
export function errorLines(a) {
  return TOOLS.flatMap((tool) =>
    (a[tool]?.hits ?? []).filter((h) => h.severity === "error").map((h) => `- ${tool}: ${h.target ?? h.file}${h.line ? `:${h.line}` : ""} \`${h.rule}\` ${String(h.detail ?? h.snippet ?? "").trim()}`.trimEnd()),
  );
}

/** Errors a fix agent can act on: a tool that didn't run isn't one. */
const hasErrors = (a) => TOOLS.some((tool) => a[tool] && !a[tool].error && a[tool].errors > 0);

export function fixPrompt(state, a) {
  return fill(read("make.fix.md"), {
    brief: state.brief,
    hits: errorLines(a).join("\n"),
    lead1: state.screens[0].id,
    lead2: state.screens[1].id,
    tells: TELLS,
  });
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

/** One screen of a product taken in, restructured from a person's notes; the other screens are left as they were. */
export function restructurePrompt(state, screen, notes, round = 1) {
  const others = state.manifest.filter((x) => x.built && x.id !== screen.id);
  return fill(read("make.restructure.md"), {
    round: String(round),
    brief: state.brief,
    id: screen.id,
    job: screen.job,
    target: screen.target,
    files: screen.inShell
      ? `it has no files of its own: the shell draws it (see \`PRODUCT.md\`), so its code and CSS live in shared files`
      : screen.files.map((f) => `\`${f}\``).join(", "),
    scope: screen.inShell ? `a class on this screen's view, or its render function` : `in ${screen.files.filter((f) => /\.(css|js)$/.test(f)).map((f) => `\`${f}\``).join(" or ") || "its own files"}`,
    others: others.map((x) => `\`${x.id}\``).join(", ") || "none",
    notes: notes.trim().split("\n").map((l) => `> ${l}`).join("\n"),
    targets: targetsOf(state).join(" "),
    leadArgs: leadsOf(state).map((l) => `--lead ${l}`).join(" "),
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
      ? "**This product was approved before you.** Read `APPROVED.md` and `PRODUCT.md` first, and keep every frozen decision unless a note names it: tokens, typefaces, the chart language, identity, the shell, the layout grid. Build the way `PRODUCT.md` says this product is built. If a note can't be met without changing a token's value, list the token in this round under `### Tokens changed`, with the note: a token changed and not listed is put back."
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
      ...rounds.map((r, i) => {
        const moved = (r.shots ?? []).filter((x) => x.changed > 0.005 && x.id !== r.screen).map((x) => `${x.id} ${(x.changed * 100).toFixed(1)}%`);
        return `- After your notes${r.screen ? ` on ${r.screen}` : ""}, round ${i + 1}: ${r.after}${tallyLine(r.ledger)}${r.screen && moved.length ? `. Other screens moved: ${moved.join(", ")} ([GUARD](rounds/${i + 1}/GUARD.md))` : ""}${r.run.ok ? "" : ` (agent stopped: ${r.run.error})`}`;
      }),
      ...(rounds.length ? ["", ...rounds.map((r, i) => `Round ${i + 1}${r.screen ? `, ${r.screen}` : ""}: ${(r.screen ? state.manifest.filter((x) => x.id === r.screen) : state.manifest.filter((x) => x.built)).map((x) => `![${x.id}](rounds/${i + 1}/shots/${shotName(x.target)})`).join(" ")}`)] : []),
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
      ...costLines(state),
      `Send it notes on one screen: \`tells make --resume ${display(out)} --revise <screen> --notes "<what to change>"\`, or on all of it: \`--revise product\`. Undo the last round: \`--undo\`.`,
      "",
    ].join("\n"),
  );
}

const runsOf = (run) => (run ? (run.runs ? Object.values(run.runs) : [run]) : []);

/** One line per stage: how many agents, how long, what they cost. */
function costLines(state) {
  const keys = Object.keys(state.runs ?? {});
  const stages = [
    ["Taken in", runsOf(state.ingest?.run)],
    ["System", [...keys.filter((k) => /^v\d+$/.test(k)).map((k) => state.runs[k]), ...(state.revisions ?? []).map((r) => r.run), ...(state.fixes ?? []).map((f) => f.run)]],
    ["Screens", keys.filter((k) => !/^v\d+$/.test(k) && k !== "review").map((k) => state.runs[k])],
    ["Review", [state.runs?.review]],
    ...(state.polishes ?? []).map((p, i) => [`Notes, round ${i + 1}`, [...runsOf(p.run), p.again]]),
  ]
    .map(([name, runs]) => [name, runs.filter(Boolean)])
    .filter(([, runs]) => runs.length);
  if (!stages.length) return [];
  return ["## What the agents cost", "", ...stages.map(([name, runs]) => `- ${name}: ${costLine(runs)}`), `- All: ${costLine(stages.flatMap(([, runs]) => runs))}`, ""];
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
      ...costLines(state),
      `Send it back with notes: \`tells make --resume ${display(out)} --revise product --notes "<what to change>"\``,
      "",
    ].join("\n"),
  );
}

// A check that couldn't run says so, rather than reading as clean.
const part = (name, x) => (x.error ? `${name} didn't run` : `${name} ${x.errors}E/${x.warnings}W`);
const line = (a) => [part("consistent", a.consistent), part("check", a.check), part("render", a.render), ...(a.click ? [part("click", a.click)] : [])].join(" · ");

/**
 * A link from a lead screen to a screen that hasn't been built yet. The system prompt allows them (the navigation
 * names the whole product), so at the checkpoint they aren't errors: the screen stage builds the pages they point at.
 */
export function dropLinksToLater(a, state) {
  const later = new Set(state.screens.slice(2).map((s) => `${s.id}.html`));
  const toLater = (h) => h.rule === "broken-link" && later.has(path.basename(String(h.detail ?? "").split("→").pop().trim().split(/[?#]/)[0]));
  const hits = (a.click.hits ?? []).filter((h) => !toLater(h));
  const count = (sev) => hits.filter((h) => h.severity === sev).length;
  return { ...a, click: { ...a.click, hits, errors: count("error"), warnings: count("warn") } };
}

/** One variant's lead screens as the person will see them: exceptions set aside, fixed, screenshotted, checked. */
function auditVariant(out, state, v) {
  const d = path.join(out, v);
  const set = quarantineAllow(d);
  if (set) state.proposed = { ...(state.proposed ?? {}), [v]: set };
  spawnSync(process.execPath, [BIN, "fix", "."], { cwd: d, stdio: "ignore" });
  tells(["measure", ...state.screens.slice(0, 2).map((s) => `screens/${s.id}.html`), "--shots", "shots", "--json"], d);
  const a = dropLinksToLater(audit(d, state), state);
  state.audits = { ...(state.audits ?? {}), [v]: line(a) };
  return a;
}

/** Write CHECKPOINT.md for the person to pick from, re-checking variants that haven't been (or `only`). */
function checkpoint(out, state, variants, { say, paint, only = null, audited = false }) {
  const rows = [];
  for (const v of variants) {
    if (!audited && (!only || only === v || !state.audits?.[v])) auditVariant(out, state, v);
    rows.push({ v, line: state.audits?.[v] ?? "" });
  }
  save(out, state);
  const shot = (v, id) => `${v}/shots/screens_${id}.html.png`;
  const proposed = (v) => state.proposed?.[v] ? [`Set aside: this variant tried to allow ${Object.keys(state.proposed[v]).join(", ")} project-wide (see ${v}/.tellsrc.proposed). It isn't applied unless you move it into .tellsrc.`, ""] : [];
  const revised = (v) => (state.revisions ?? []).filter((r) => r.v === v).length;
  const fixed = (v) => {
    const f = (state.fixes ?? []).filter((x) => x.v === v).at(-1);
    if (!f) return [];
    return [
      `Failed its own checks ${f.when === "system" ? "when built" : `after ${f.when}`} (${f.before}); one fix round${fs.existsSync(path.join(out, v, "FIXES.md")) ? `, see [FIXES](${v}/FIXES.md)` : ""}.`,
      ...(f.left?.length ? ["", `**Still failing:**`, "", ...f.left, ""] : [""]),
    ];
  };
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
        ...fixed(v),
        ...proposed(v),
      ]),
      `Approve: \`tells make --resume ${display(out)} --approve <v>\``,
      `Or revise first: \`tells make --resume ${display(out)} --revise <v> --notes "<what to change>"\``,
      "",
    ].join("\n"),
  );
  say("");
  for (const { v, line: l } of rows) {
    const left = (state.fixes ?? []).filter((x) => x.v === v).at(-1)?.left?.length;
    say(`${paint.bold(v)}  ${paint.dim(l)}${left ? paint.red(`  still failing after its fix round`) : ""}`);
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
async function startFrom({ valueOf, positional, flags, widths }) {
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
  const values = new Set([valueOf("from"), valueOf("screens"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("timeout"), valueOf("approved"), valueOf("widths")].filter(Boolean));
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
  writeWidths(product, widths);
  // The product as it came: what the describing agent's changes are put back to.
  copyProduct(product, path.join(out, "rounds", "0"));
  const state = {
    origin: "from", source, layout: found.layout, entry: found.entry, brief, screens, manifest, leads, skipped, widths,
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
  let widths = null;
  if (valueOf("widths")) {
    try {
      widths = parseWidths(valueOf("widths"));
    } catch (err) {
      console.error(`tells make: ${err.message}`);
      process.exit(2);
    }
  }

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
    if (widths) state.widths = widths; // from here on
  } else if (valueOf("from")) {
    ({ out, state } = await startFrom({ valueOf, positional, flags, widths }));
  } else {
    const values = new Set([valueOf("screens"), valueOf("variants"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("timeout"), valueOf("assets"), valueOf("concurrency"), valueOf("notes"), valueOf("widths"), ...many("reference"), ...many("kind")].filter(Boolean));
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
      brief, screens, style: Boolean(flags.style), assets, variants, widths,
      refs: refs.map((r) => ({ name: r.name, url: r.url ?? null, why: r.why ?? null, png: r.png })),
      stage: "system", approved: null, built: {}, runs: {}, started: new Date().toISOString(),
    };
    fs.mkdirSync(out, { recursive: true });
    save(out, state);
  }

  const timeoutFor = (kind) => (minutes ?? MINUTES[kind]) * 60_000;
  // Every agent's stream is kept under agents/, by stage, for the cost lines and scripts/make-timeline.mjs.
  let warnedSignIn = false;
  const agentRun = async (label, opts) => {
    writeWidths(opts.dir, state.widths);
    const r = await runAgent({ ...opts, stream: path.join(out, "agents", `${label}.jsonl`) });
    writeWidths(opts.dir, state.widths);
    if (r.signInEnds && !warnedSignIn && Date.parse(r.signInEnds) - Date.now() < 36 * 3600_000) {
      warnedSignIn = true;
      say(paint.yellow(`  Claude Code's sign-in ends ${r.signInEnds.slice(0, 16).replace("T", " ")} UTC. For long unattended runs, use \`claude setup-token\`.`));
    }
    return r;
  };

  // Before the person sees a variant: check it, and if it fails its own checks, one agent fixes the errors (warnings
  // don't count) and it's checked again. One round: what still fails goes to the checkpoint marked.
  const fixRound = async (variants, when) => {
    const before = Object.fromEntries(variants.map((v) => [v, auditVariant(out, state, v)]));
    const broken = variants.filter((v) => hasErrors(before[v]));
    save(out, state);
    if (!broken.length) return;
    say(`${paint.bold("Fixing")} ${broken.join(", ")}: ${broken.map((v) => `${v} ${line(before[v])}`).join("; ")}`);
    const entries = await Promise.all(
      broken.map(async (v) => {
        const dir = path.join(out, v);
        const prompt = fixPrompt(state, before[v]);
        const n = (state.fixes ?? []).filter((x) => x.v === v).length + 1;
        fs.writeFileSync(path.join(dir, `FIX-${n}.md`), prompt);
        const label = `fix-${v}-${n}`;
        const r = await agentRun(label, { dir, prompt, agent, model, timeoutMs: timeoutFor("system") });
        say(`  ${v}  ${r.ok ? paint.green("fixed") : paint.yellow(r.error)}  ${r.seconds}s`);
        return { v, when, label, run: r, before: line(before[v]) };
      }),
    );
    for (const e of entries) {
      const after = auditVariant(out, state, e.v);
      e.after = line(after);
      if (hasErrors(after)) e.left = errorLines(after).slice(0, 30);
    }
    state.fixes = [...(state.fixes ?? []), ...entries];
    save(out, state);
  };

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
        screens: a.consistent.screens,
        // The client's own hits: only new ones count against a round.
        hits: ["consistent", "check", "render", "click"].flatMap((tool) => a[tool].hits.map((h) => hitSignature(tool, h))),
        line: line(a),
      };
      save(out, state);
      say(`  ${paint.dim(state.baseline.line)}`);
    }
    say(`${paint.bold("Describing")} the product: SYSTEM, CONTRACTS, APPROVED and PRODUCT, changing nothing`);
    const r = await agentRun("ingest", { dir: product, prompt, agent, model, timeoutMs: timeoutFor("ingest") });
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
        const r = await agentRun(`system-${v}`, { dir, prompt: texts[i], agent, model, timeoutMs: timeoutFor("system") });
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
    const vs = built.map((d) => path.basename(d));
    await fixRound(vs, "system");
    checkpoint(out, state, vs, { say, paint, audited: true });
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
    const r = await agentRun(`revise-${v}-${n}`, { dir, prompt, agent, model, timeoutMs: timeoutFor("system") });
    state.revisions = [...(state.revisions ?? []), { v, notes, run: r }];
    save(out, state);
    say(`  ${v}  ${r.ok ? paint.green("revised") : paint.yellow(r.error)}  ${r.seconds}s`);
    const variants = fs.readdirSync(out).filter((n) => /^v\d+$/.test(n) && fs.existsSync(path.join(out, n, "SYSTEM.md")));
    await fixRound([v], `revise ${n}`);
    checkpoint(out, state, variants, { say, paint, audited: true });
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
    copyTree(path.join(out, v), product, (name) => ["shots", "agent.log", "PROMPT.md", "study.html", ".tellsrc.proposed"].includes(name) || /^reference-\d+\.png$|^(REVISE|FIX)-\d+\.md$/.test(name));
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
      copyTree(product, work, (name) => NOT_FOR_SCREENS.has(name));
      const prompt = screenPrompt(state, s);
      fs.writeFileSync(path.join(work, "PROMPT.md"), prompt);
      const r = await agentRun(`screen-${s.id}`, { dir: work, prompt, agent, model, timeoutMs: timeoutFor("screen") });
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
      const r = await agentRun("review", { dir: product, prompt, agent, model, timeoutMs: timeoutFor("review") });
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

  // ---- 4. Your notes on the built product: one agent, then every check again --------------------------------
  // --revise product: the whole product, each note fixed at its cause. --revise <screen> (a product taken in with
  // --from): one screen restructured, the others left as they were. Rounds on a product taken in are guarded: a
  // snapshot first, then token, trait and screenshot checks against it, one turn to put back what wasn't asked for,
  // and the snapshot restored if it still isn't. --undo puts the last round back.
  if (state.stage === "done" && flags.undo) {
    const n = (state.polishes ?? []).length;
    const before = path.join(out, "rounds", String(n), "before");
    if (!n || !fs.existsSync(before)) {
      console.error(`tells make: no round to undo${n ? ` (round ${n} kept no snapshot)` : ""}.`);
      process.exit(2);
    }
    restoreExcept(product, before, (f) => f === "agent.log");
    state.polishes = state.polishes.slice(0, -1);
    state.undone = [...(state.undone ?? []), n];
    save(out, state);
    writeReport(out, state);
    say(`${paint.bold("Undone")} round ${n}: ${display(product)} is as it was before it.`);
    return;
  }
  // Before a guarded round: a snapshot of the product, its tokens and its exceptions, and the baseline's traits.
  const beginRound = () => {
    const n = (state.polishes ?? []).length + 1;
    const roundDir = path.join(out, "rounds", String(n));
    fs.rmSync(roundDir, { recursive: true, force: true });
    copyProduct(product, path.join(roundDir, "before"));
    if (!state.baseline.screens) {
      // Runs taken in before traits were kept: read them now, before anything changes.
      state.baseline.screens = tells(["consistent", ...targetsOf(state), "--json"], product).screens ?? [];
      save(out, state);
    }
    return { n, roundDir, tokensBefore: readTokens(product), allowBefore: readAllow(product) };
  };
  // After the agents: guard, one turn to put back what wasn't asked for, else the snapshot. Returns false when undone.
  const guardRound = async ({ n, roundDir, tokensBefore, allowBefore }, allowed, blockTraits, prompt) => {
    applyDeletions(product);
    quarantineAllow(product, allowBefore);
    let guard = runGuard(product, state, n, tokensBefore, allowed, blockTraits);
    if (!guard.blocking.length) return { guard, turns: 1 };
    say(paint.yellow(`  changed what the notes didn't ask for: ${guard.blocking.map((v) => v.what).join("; ")}`));
    fs.writeFileSync(path.join(product, "GUARD.md"), guardText(guard, n));
    const again = `${prompt}\n\n## Put these back\n\nYour round changed things the notes didn't ask for (\`GUARD.md\`):\n\n${guard.blocking.map((v) => `- ${v.what}`).join("\n")}\n\nPut each one back as it was. If a note truly needed a token changed, list it under "### Tokens changed" in round ${n} of \`POLISH.md\`, with the note.`;
    const r2 = await agentRun(`round-${n}-again`, { dir: product, prompt: again, agent, model, timeoutMs: timeoutFor("review") });
    say(`  ${r2.ok ? paint.green("second turn") : paint.yellow(r2.error)}  ${r2.seconds}s`);
    applyDeletions(product);
    quarantineAllow(product, allowBefore);
    guard = runGuard(product, state, n, tokensBefore, allowed, blockTraits);
    fs.rmSync(path.join(product, "GUARD.md"), { force: true });
    if (!guard.blocking.length) return { guard, turns: 2, again: r2 };
    restoreExcept(product, path.join(roundDir, "before"), (f) => f === "agent.log");
    fs.writeFileSync(path.join(roundDir, "GUARD.md"), guardText(guard, n));
    say(paint.red(`  still changed: ${guard.blocking.map((v) => v.what).join("; ")}. Put the product back as it was before round ${n}.`));
    say(paint.dim(`  What it tried: ${display(path.join(roundDir, "GUARD.md"))}`));
    process.exitCode = 1;
    return null;
  };
  // Every check again, screenshots against the round before, and the round written down.
  const finishRound = async (round, entry, show, guard) => {
    tells(["measure", ...targetsOf(state), "--shots", "shots", "--json"], product);
    const after = audit(product, state);
    fs.cpSync(path.join(product, "shots"), path.join(round.roundDir, "shots"), { recursive: true });
    const shots = await shotChanges(out, state, round.n);
    fs.writeFileSync(path.join(round.roundDir, "GUARD.md"), guardText({ ...guard, shots }, round.n));
    // consistent compares screens with the approved ones. When a round changes an approved screen, the screens it
    // didn't touch now differ from it without having moved: only drift from how a screen came in counts.
    const drifted = new Set(traitViolations(state.baseline.screens ?? [], after.consistent.screens ?? []).map((v) => v.target));
    after.consistent.hits = after.consistent.hits.filter((h) => !h.rule.startsWith("drift-") || drifted.has(h.target));
    const counted = { ...after, ...newHits(after, state.baseline.hits, hitSignature) };
    const ledger = tallyNotes(readLedger(path.join(product, "NOTES.jsonl")), round.n);
    state.polishes = [...(state.polishes ?? []), { ...entry, after: `${line(counted)} new since it came in`, ledger, shots, at: new Date().toISOString() }];
    save(out, state);
    writeReport(out, state);
    say(`${paint.bold("Done")}  ${paint.dim(`${line(counted)} new since it came in${tallyLine(ledger)}`)}`);
    for (const id of show) say(`  ${display(path.join(product, "shots", shotOf(state, id)))}`);
    const moved = shots.filter((x) => x.changed > 0.005 && !show.includes(x.id));
    if (moved.length) say(paint.yellow(`  other screens moved: ${moved.map((x) => `${x.id} ${(x.changed * 100).toFixed(1)}%`).join(", ")} (see REPORT.md)`));
    say(paint.dim(`What changed: ${display(path.join(product, "POLISH.md"))}. Undo: tells make --resume ${display(out)} --undo`));
    if (counted.consistent.errors || counted.check.errors || counted.render.errors || counted.click?.errors) process.exitCode = 1;
  };

  // --carry <screen> [--to a,b]: one screen's layout, written down and lifted into shared rules, then laid onto
  // the others. --add "<id>: <job>; …": new screens built the house way. Both on a product taken in with --from.
  if (state.stage === "done" && (valueOf("carry") || valueOf("add"))) {
    if (state.origin !== "from") {
      console.error("tells make: --carry and --add work on a product taken in with --from.");
      process.exit(2);
    }
    const notesArg = valueOf("notes");
    const notes = notesArg && fs.existsSync(notesArg) ? fs.readFileSync(notesArg, "utf8") : notesArg ?? "";
    const built = state.manifest.filter((x) => x.built);
    const ids = built.map((x) => x.id).join(", ");

    if (valueOf("carry")) {
      const source = built.find((x) => x.id === valueOf("carry"));
      const toIds = valueOf("to") ? valueOf("to").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : built.filter((x) => x.id !== source?.id).map((x) => x.id);
      const bad = toIds.filter((id) => !built.some((x) => x.id === id) || id === source?.id);
      if (!source || !toIds.length || bad.length) {
        console.error(`tells make: --carry <screen> [--to a,b] takes built screens: ${ids}.${bad.length ? ` Not one: ${bad.join(", ")}.` : ""}`);
        process.exit(2);
      }
      const targets = toIds.map((id) => built.find((x) => x.id === id));
      const round = beginRound();
      const carryPrompt = fill(read("make.carry.md"), {
        round: String(round.n), brief: state.brief, id: source.id, job: source.job, target: source.target,
        to: targets.map((x) => `\`${x.id}\``).join(", "),
        files: source.inShell ? "the shell draws it, see `PRODUCT.md`" : source.files.map((f) => `\`${f}\``).join(", "),
        notes: notes ? `**Their notes:**\n\n${notes.trim().split("\n").map((l) => `> ${l}`).join("\n")}` : "",
        tells: TELLS,
      });
      fs.writeFileSync(path.join(out, `POLISH-PROMPT-${round.n}.md`), carryPrompt);
      say(`${paint.bold("Carrying")} ${source.id}'s layout to ${toIds.join(", ")}, round ${round.n}`);
      const r1 = await agentRun(`round-${round.n}-pattern`, { dir: product, prompt: carryPrompt, agent, model, timeoutMs: timeoutFor("review") });
      say(`  ${"pattern".padEnd(14)} ${r1.ok && fs.existsSync(path.join(product, "PATTERN.md")) ? paint.green("written") : paint.red(r1.error ?? "no PATTERN.md")}  ${r1.seconds}s`);
      if (!fs.existsSync(path.join(product, "PATTERN.md"))) {
        restoreExcept(product, path.join(round.roundDir, "before"), (f) => f === "agent.log");
        say(paint.red(`  no PATTERN.md: the product is as it was before round ${round.n}.`));
        process.exitCode = 1;
        return;
      }
      const laid = `Lay this screen on the pattern in \`PATTERN.md\`, carried over from \`${source.id}\`: its rules, separators, height unit and column split, using the shared rules it names. Keep this screen's own shape, charts, content and order.${notes ? `\n${notes.trim()}` : ""}`;
      const runs = { pattern: r1 };
      // Screens with files of their own: in parallel, each in its own copy; only its own files come back.
      await pool(targets.filter((t) => !t.inShell), concurrency, async (t) => {
        const work = path.join(out, "work", `round-${round.n}`, t.id);
        fs.rmSync(work, { recursive: true, force: true });
        copyProduct(product, work);
        const r = await agentRun(`round-${round.n}-${t.id}`, { dir: work, prompt: restructurePrompt(state, t, laid, round.n), agent, model, timeoutMs: timeoutFor("screen") });
        for (const f of t.files) if (fs.existsSync(path.join(work, f))) fs.copyFileSync(path.join(work, f), path.join(product, f));
        runs[t.id] = r;
        say(`  ${t.id.padEnd(14)} ${r.ok ? paint.green("laid") : paint.yellow(r.error)}  ${r.seconds}s`);
      });
      // Screens the shell draws share its files, so they go one at a time, in place.
      for (const t of targets.filter((x) => x.inShell)) {
        const r = await agentRun(`round-${round.n}-${t.id}`, { dir: product, prompt: restructurePrompt(state, t, laid, round.n), agent, model, timeoutMs: timeoutFor("screen") });
        runs[t.id] = r;
        say(`  ${t.id.padEnd(14)} ${r.ok ? paint.green("laid") : paint.yellow(r.error)}  ${r.seconds}s`);
      }
      const allowed = new Set([source.target, ...targets.map((t) => t.target)]);
      const g = await guardRound(round, allowed, true, carryPrompt);
      if (!g) return;
      await finishRound(round, { carry: source.id, to: toIds, notes, run: { ok: Object.values(runs).every((r) => r.ok), runs, turns: g.turns }, again: g.again }, [source.id, ...toIds], g.guard);
      return;
    }

    // --add
    let adds = [];
    try {
      adds = parseScreens(valueOf("add"));
    } catch (err) {
      console.error(`tells make: ${err.message}`);
      process.exit(2);
    }
    const taken = adds.filter((a) => state.manifest.some((x) => x.id === a.id && x.built));
    if (!adds.length || taken.length) {
      console.error(`tells make: --add "<id>: <job>; …" takes new screens.${taken.length ? ` Already built: ${taken.map((a) => a.id).join(", ")}.` : ""}`);
      process.exit(2);
    }
    const round = beginRound();
    const entry = state.manifest.find((x) => x.built)?.target ?? "";
    const routeOf = (id) => (state.layout === "spa" ? `${state.entry}${entry.includes("#/") ? "#/" : "#"}${id}` : `screens/${id}.html`);
    say(`${paint.bold("Adding")} ${adds.map((a) => a.id).join(", ")}, round ${round.n}`);
    const runs = {};
    let lastPrompt = "";
    // One at a time, in place: registering a screen edits shared files.
    for (const a of adds) {
      lastPrompt = fill(read("make.add.md"), {
        round: String(round.n), brief: state.brief, id: a.id, job: a.job,
        others: built.map((x) => `\`${x.id}\` (${x.job})`).join(", "),
        notes: notes ? `**Their notes:**\n\n${notes.trim().split("\n").map((l) => `> ${l}`).join("\n")}` : "",
        targets: targetsOf(state).join(" "), newTarget: routeOf(a.id),
        leadArgs: leadsOf(state).map((l) => `--lead ${l}`).join(" "), tells: TELLS,
      });
      fs.writeFileSync(path.join(out, `POLISH-PROMPT-${round.n}-${a.id}.md`), lastPrompt);
      const r = await agentRun(`round-${round.n}-${a.id}`, { dir: product, prompt: lastPrompt, agent, model, timeoutMs: timeoutFor("screen") });
      runs[a.id] = r;
      say(`  ${a.id.padEnd(14)} ${r.ok ? paint.green("built") : paint.yellow(r.error)}  ${r.seconds}s`);
    }
    // Only the new screens may differ from how they came: every screen that was there is held to its baseline.
    const g = await guardRound(round, new Set(adds.map((a) => routeOf(a.id))), true, lastPrompt);
    if (!g) return;
    const found = await discoverScreens(product);
    const jobs = Object.fromEntries([...state.manifest, ...adds].map((x) => [x.id, x.job]));
    state.manifest = found.screens.map((x) => ({ ...x, job: jobs[x.id] ?? x.job }));
    fs.writeFileSync(path.join(product, "screens.json"), JSON.stringify(state.manifest, null, 2) + "\n");
    const missing = adds.filter((a) => !state.manifest.some((x) => x.id === a.id && x.built)).map((a) => a.id);
    for (const a of adds) if (!missing.includes(a.id) && !state.screens.some((x) => x.id === a.id)) state.screens.push(a);
    if (missing.length) say(paint.red(`  not found in the navigation afterwards: ${missing.join(", ")}`));
    await finishRound(round, { add: adds.map((a) => a.id), notes, run: { ok: Object.values(runs).every((r) => r.ok) && !missing.length, runs, turns: g.turns }, again: g.again }, adds.map((a) => a.id).filter((id) => !missing.includes(id)), g.guard);
    if (missing.length) process.exitCode = 1;
    return;
  }

  if (state.stage === "done" && valueOf("revise")) {
    const notesArg = valueOf("notes");
    const notes = notesArg && fs.existsSync(notesArg) ? fs.readFileSync(notesArg, "utf8") : notesArg;
    const which = valueOf("revise");
    const screen = which === "product" ? null : state.manifest?.find((x) => x.id === which && x.built);
    if (!notes || (which !== "product" && !screen)) {
      const ids = state.manifest ? ` or one screen: ${state.manifest.filter((x) => x.built).map((x) => x.id).join(", ")}` : "";
      console.error(`tells make: the product is built. Send it back with --revise product${ids}, and --notes "<what to change>" (or a notes file).`);
      process.exit(2);
    }
    const guarded = state.origin === "from";
    const round = guarded ? beginRound() : { n: (state.polishes ?? []).length + 1 };
    const n = round.n;
    const prompt = screen ? restructurePrompt(state, screen, notes, n) : polishPrompt(state, notes, n);
    fs.writeFileSync(path.join(out, `POLISH-PROMPT-${n}.md`), prompt);
    say(screen ? `${paint.bold("Restructuring")} ${screen.id} with your notes, round ${n}` : `${paint.bold("Polishing")} the product with your notes, round ${n}`);
    const r = await agentRun(`round-${n}`, { dir: product, prompt, agent, model, timeoutMs: timeoutFor("review") });
    say(`  ${r.ok ? paint.green(screen ? "restructured" : "polished") : paint.yellow(r.error)}  ${r.seconds}s`);

    if (guarded) {
      // A one-screen round holds every other screen to how it came; a whole-product round only reports drift.
      const g = await guardRound(round, new Set(screen ? [screen.target] : targetsOf(state)), Boolean(screen), prompt);
      if (!g) return;
      await finishRound(round, { screen: screen?.id ?? null, notes, run: { ...r, turns: g.turns }, again: g.again }, screen ? [screen.id] : state.screens.map((x) => x.id), g.guard);
      return;
    }

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
    for (const x of state.screens) say(`  ${display(path.join(product, "shots", shotOf(state, x.id)))}`);
    if (setAside) say(paint.yellow(`  set aside: allow ${Object.keys(setAside).join(", ")} (product/.tellsrc.proposed)`));
    say(paint.dim(`What changed: ${display(path.join(product, "POLISH.md"))}. Again: tells make --resume ${display(out)} --revise product --notes "<what to change>"`));
    if (!r.ok || after.consistent.errors || after.check.errors || after.render.errors || after.click?.errors) process.exitCode = 1;
    return;
  }

  if (state.stage === "done") say(`Already done. Report: ${display(path.join(out, "REPORT.md"))}. Send it back with notes: tells make --resume ${display(out)} --revise product --notes "<what to change>"`);
}
