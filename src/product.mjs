/**
 * tells make --product: a product of several screens, built system first.
 *
 * Usage:
 *   tells make "<product brief>" --product --screens "<id>: <job>; <id>: <job>; …"
 *              [--reference <r>]... [--kind <k>] [--style] [--assets <dir>] [--variants 2] [--concurrency 3]
 *              [--out <dir>] [--agent "<cmd>"] [--model <id>] [--timeout <minutes>] [--dry-run]
 *   tells make --resume <out> --approve v1      continue from the system you chose
 *   tells make --resume <out>                   pick up a stopped run (failed screens run again)
 *
 * 1. System: each variant designs the whole product's system (tokens, parts, shell, store, one chart language),
 *    one world of sample facts, the shared-state contracts, and the first two screens. Then it stops: a person
 *    looks at the lead screens and approves one system. Taste is decided once, where it matters.
 * 2. Screens: one agent per remaining screen, in parallel, each in its own copy of the approved product. Only
 *    the files it owns come back (screens/<id>.*, data/<id>.js); what it needed from the system it writes down.
 * 3. Review: `tells consistent` across the screens, check and render, then one agent folds the needs into the
 *    system, fixes the drift, walks the contracts, and re-runs every check.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TELLS = path.resolve(HERE, "..");
const BIN = path.join(TELLS, "bin", "tells.mjs");
const MINUTES = { system: 50, screen: 35, review: 45 };

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
  const leads = state.screens.slice(0, 2).map((s) => `screens/${s.id}.html`).filter((f) => fs.existsSync(path.join(dir, f)));
  const cons = tells(["consistent", "screens", ...leads.flatMap((l) => ["--lead", l]), "--json"], dir);
  const chk = tells(["check", ".", "--json"], dir);
  const ren = tells(["render", "screens", "--json", "--widths", "1440,390"], dir);
  const clk = tells(["click", "screens", "--json"], dir);
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
    // Agents run only node, so deletions they want come as a list; only files inside the product go.
    const delList = path.join(product, "DELETE.txt");
    if (fs.existsSync(delList)) {
      const removed = [];
      for (const rel of fs.readFileSync(delList, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) {
        const abs = path.resolve(product, rel);
        if (abs.startsWith(product + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          fs.rmSync(abs);
          removed.push(rel);
        }
      }
      fs.rmSync(delList);
      state.deleted = removed;
    }
    const setAside = quarantineAllow(product);
    if (setAside) state.proposed = { ...(state.proposed ?? {}), review: setAside };
    tells(["measure", "screens", "--shots", "shots", "--json"], product);
    const after = audit(product, state);
    state.stage = "done";
    state.finished = new Date().toISOString();
    state.result = { before: line(before), after: line(after) };
    save(out, state);
    fs.writeFileSync(
      path.join(out, "REPORT.md"),
      [
        `# ${state.brief}`,
        "",
        `Built on ${state.approved}'s system: [product/screens](product/screens). Start at [${state.screens[0].id}](product/screens/${state.screens[0].id}.html).`,
        "",
        `- Before review: ${line(before)}`,
        `- After review: ${line(after)}`,
        "",
        "| Screen | Job | Screenshot |",
        "|---|---|---|",
        ...state.screens.map((s) => `| [${s.id}](product/screens/${s.id}.html) | ${s.job} | ![${s.id}](product/shots/screens_${s.id}.html.png) |`),
        "",
        "What the review changed: [REVIEW.md](product/REVIEW.md). The system: [SYSTEM.md](product/SYSTEM.md), [CONTRACTS.md](product/CONTRACTS.md).",
        "",
      ].join("\n"),
    );
    say(`${paint.bold("Done")}  ${paint.dim(line(after))}`);
    say(`Start at ${display(path.join(product, "screens", `${state.screens[0].id}.html`))}`);
    say(paint.dim(`Report: ${display(path.join(out, "REPORT.md"))}`));
    if (after.consistent.errors || after.check.errors || after.render.errors) process.exitCode = 1;
    return;
  }

  if (state.stage === "done") say(`Already done. Report: ${display(path.join(out, "REPORT.md"))}`);
}
