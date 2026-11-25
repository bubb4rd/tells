/**
 * tells make: brief in, one checked design out, with no picks in between.
 *
 * Usage:
 *   tells make "<brief>" [--reference <name|url|file>]... [--kind <kind>] [--page landing|product]
 *                        [--assets <dir>] [--current <screenshot>] [--style] [--variants 4] [--out <dir>]
 *                        [--agent "<command>"] [--model <id>] [--against <path>]... [--house <path>]
 *                        [--no-render] [--timeout <minutes>] [--dry-run]
 *
 * 1. Writes one prompt per variant. With references (--reference, or --kind for every library reference of
 *    that kind), each agent studies a shipped screen, builds the brief with its decisions, and critiques
 *    against it (src/make.study.md, or src/make.landing.md for a landing page, which studies the reference's
 *    hero, imagery and pacing). Variants rotate through the references, so each studies a different one.
 *    Without references, each variant gets a different angle (src/make.prompt.md).
 * 2. Runs an agent per variant, in parallel, in its own folder. The default agent is Claude Code
 *    (`claude -p`); --agent takes any command that reads the prompt on stdin and works in its cwd.
 * 3. Runs `tells fix` on every variant, then `tells pick` to choose one.
 * 4. Writes REPORT.md: the ranking, why each loser lost, and the winner's path.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { display, makePaint, parseArgs } from "./check.mjs";
import { measure, rank, printRanking, ruleCount } from "./pick.mjs";
import { resolveReferences } from "./references.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TELLS = path.resolve(HERE, "..");
const BIN = path.join(TELLS, "bin", "tells.mjs");

// Every angle leads with the product; they differ in where the character comes from.
// Metaphor-led pages won 0 of 41 in blind tests (playbook/taste.md), so none of these is a metaphor.
export const ANGLES = [
  "Take the character from the product's own data: the number or status this user checks most, made the centrepiece of the screen.",
  "Take the character from the documents this subject already prints or sends (tickets, forms, receipts, labels, timetables). Borrow one mark or one colour from them, never their layout.",
  "Take the character from the place or tools where the job happens: one material colour and one shape, each with its origin named.",
  "Take the character from the people who use it: their words, their pace, what they glance at between tasks. Write the copy first, then design around it.",
  "Take the character from the rhythm of the job (shifts, seasons, deadlines) and let it set the hierarchy of the screen.",
  "Take the character from the region or history of this subject: one detail that would only fit here.",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);

export function prompts(brief, n) {
  const template = fs.readFileSync(path.join(HERE, "make.prompt.md"), "utf8");
  return Array.from({ length: n }, (_, i) =>
    template
      .replaceAll("{{k}}", String(i + 1))
      .replaceAll("{{n}}", String(n))
      .replaceAll("{{brief}}", brief)
      .replaceAll("{{angle}}", ANGLES[i % ANGLES.length])
      .replaceAll("{{tells}}", TELLS),
  );
}

/** A brief for the front door of something, not a screen people work in. `--page` overrides. */
export const isLanding = (brief) => /\b(landing|home ?page|homepage|website|web ?site|marketing (page|site)|launch page|splash)\b/i.test(brief);

const ART = {
  assets: "Use the files in `assets/` (logos, photos, key art) as the imagery, cropped, scaled and layered the way the main reference does.",
  none: "There are no photos or logos for this subject, so make the art yourself in inline SVG and CSS: a mark for the brand and for every team or person it features, key art for the hero built from shape, type, texture and light taken from the subject's own world (its places, objects, symbols and interfaces), and a showpiece for the best real content, such as a champions card. Make it bold and specific to this subject. Glows, gradient blobs and abstract shapes that could belong to anything don't count.",
};

/**
 * One prompt per variant that studies the references instead of following an angle.
 * Variants rotate through the references as their main one, so they don't all study the same screen.
 */
const PALETTE = {
  product: "Choose the palette and the theme (light or dark) from the subject and where the screen is used, not from the reference, and say why in NOTES.md. Don't copy its brand, its navigation or its wording.",
  landing: "Choose the palette from the subject and its world, and say why in NOTES.md. Don't reuse the reference's brand colours, logo, wording or artwork. Make one look of your own, not the look of every esports or product template.",
  style: "The look comes from the main reference too: it was chosen for its style. Carry over its theme, palette, type families and weights, surfaces and lines, and its signature graphic, redrawn for this subject's own data and world. The rule set still wins: its tells stay out even here. Don't copy its logo or its wording.",
};

export function studyPrompts(brief, n, refs, { page = "product", assets = false, current = null, style = false } = {}) {
  const template = fs.readFileSync(path.join(HERE, page === "landing" ? "make.landing.md" : "make.study.md"), "utf8");
  const list = refs
    .map((r, i) => `- \`reference-${i + 1}.png\`: ${r.name}${r.url ? ` (${r.url})` : ""}${r.why ? `. Why it's good: ${r.why}` : ""}`)
    .join("\n");
  return Array.from({ length: n }, (_, i) =>
    template
      .replaceAll("{{k}}", String(i + 1))
      .replaceAll("{{n}}", String(n))
      .replaceAll("{{brief}}", brief)
      .replaceAll("{{references}}", list)
      .replaceAll("{{main}}", String((i % refs.length) + 1))
      .replaceAll("{{rotation}}", refs.length > 1 ? " The other variants study the others, so the set covers the range. Use the rest only as contrast." : "")
      .replaceAll(
        "{{current}}",
        current
          ? `**The page you're redesigning.** \`${current}\` in this folder is that page as it is now. Keep every job it does and every real name and number on it; where it's cut off, stop there. Never invent names, numbers, tracks or rows that aren't on it. Change the design: the references and the brief say how.`
          : "",
      )
      .replaceAll("{{palette}}", style ? PALETTE.style : PALETTE[page])
      .replaceAll("{{assets}}", assets ? "**Assets.** `assets/` holds real files for this subject: logos, photos, art. Use them." : "")
      .replaceAll("{{art}}", assets ? ART.assets : ART.none)
      .replaceAll("{{tells}}", TELLS)
      .replace(/\n{3,}/g, "\n\n"),
  );
}

export function runAgent({ dir, prompt, agent, model, timeoutMs }) {
  return new Promise((resolve) => {
    const log = fs.openSync(path.join(dir, "agent.log"), "w");
    const child = agent
      ? spawn(agent, { cwd: dir, shell: true, stdio: ["pipe", log, log] })
      : spawn("claude", [
          "-p", "--no-session-persistence",
          "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(node:*)",
          "--add-dir", TELLS,
          ...(model ? ["--model", model] : []),
        ], { cwd: dir, stdio: ["pipe", log, log] });
    const started = Date.now();
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.code === "ENOENT" ? "agent command not found" : err.message, seconds: 0 });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(log);
      const seconds = Math.round((Date.now() - started) / 1000);
      resolve({ ok: code === 0, error: signal ? `stopped after ${seconds}s (${signal})` : code ? `exit ${code}` : null, seconds });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

function report({ brief, out, ranked, runs, refs }) {
  const rows = ranked.map((r) => {
    const v = path.basename(r.variant);
    const run = runs[v];
    return `| ${r.rank} | [${v}](${v}/index.html) | ${ruleCount(r.errors)} | ${r.exceptions} | ${r.lands.length ? r.lands.join(", ") : "no"} | ${r.houseOf ? `${r.houseAxes}/${r.houseOf}` : "–"} | ${r.warnings.length} | ${run?.seconds ?? "–"}s |`;
  });
  const win = ranked[0];
  return [
    `# ${brief}`,
    "",
    `Winner: **${path.basename(win.variant)}** ([index.html](${path.basename(win.variant)}/index.html)${win.notes ? `, [notes](${path.basename(win.variant)}/NOTES.md)` : ""})${win.errors.length ? `. It still breaks ${ruleCount(win.errors)} rule${ruleCount(win.errors) === 1 ? "" : "s"}; no variant was clean.` : "."}`,
    "",
    "| # | Variant | Rules broken | Exceptions | Default look | House axes | Warnings | Time |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Why the others lost",
    "",
    ...ranked.slice(1).map((r) => `- **${path.basename(r.variant)}:** ${r.why}`),
    "",
    ...(refs.length
      ? ["## References", "", ...refs.map((r, i) => `- \`reference-${i + 1}.png\`: ${r.name}${r.url ? ` (${r.url})` : ""}`), "", "Each variant's STUDY.md, CRITIQUE.md and NOTES.md say what it carried over and what still falls short."]
      : ["## Angles", "", ...ranked.map((r) => `- **${path.basename(r.variant)}:** ${ANGLES[(Number(path.basename(r.variant).slice(1)) - 1) % ANGLES.length]}`)]),
    "",
    `Chosen by \`tells pick\`: fewest rules broken, then fewest written exceptions, then off the cliché clusters and your house style. Warnings are shown but don't decide. No taste model; see playbook/taste.md.`,
    "",
  ].join("\n");
}

export async function run(argv = process.argv.slice(2)) {
  // A product of several screens is built system first: src/product.mjs
  if (argv.includes("--product") || argv.includes("--resume")) return (await import("./product.mjs")).run(argv);
  const { positional, flags } = parseArgs(argv);
  const valueOf = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : typeof flags[name] === "string" ? flags[name] : null;
  };
  const many = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--") ? [argv[i + 1]] : []));
  const against = many("against");
  const refSpecs = many("reference");
  const kinds = many("kind");
  const values = new Set([valueOf("variants"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("house"), valueOf("timeout"), valueOf("page"), valueOf("assets"), valueOf("current"), ...against, ...refSpecs, ...kinds].filter(Boolean));
  const brief = positional.filter((p) => !values.has(p)).join(" ").trim();
  if (!brief) {
    console.error('tells make: give it a brief, e.g. tells make "a booking screen for a bike repair shop"');
    process.exit(2);
  }
  const n = Math.max(2, Math.min(12, Number(valueOf("variants")) || 4));
  const out = path.resolve(valueOf("out") ?? path.join("tells-make", `${slug(brief)}-${stamp()}`));
  const agent = valueOf("agent");
  const timeoutMs = (Number(valueOf("timeout")) || (refSpecs.length || kinds.length ? 40 : 20)) * 60_000;
  const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const say = (s) => process.stdout.write(s + "\n");

  const page = valueOf("page") ?? (isLanding(brief) ? "landing" : "product");
  if (!["landing", "product"].includes(page)) {
    console.error(`tells make: --page is landing or product, not "${page}"`);
    process.exit(2);
  }
  const assets = valueOf("assets") ? path.resolve(valueOf("assets")) : null;
  const current = valueOf("current") ? path.resolve(valueOf("current")) : null;
  if (current && !fs.existsSync(current)) {
    console.error(`tells make: --current ${display(current)} doesn't exist`);
    process.exit(2);
  }
  const currentName = current ? `current${path.extname(current).toLowerCase() || ".png"}` : null;
  if (assets && !fs.statSync(assets, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`tells make: --assets needs a folder, and ${display(assets)} isn't one`);
    process.exit(2);
  }
  let refs = [];
  if (refSpecs.length || kinds.length) {
    try {
      refs = await resolveReferences({ specs: refSpecs, kinds, dir: path.join(out, "references"), fullPage: page === "landing" });
    } catch (err) {
      console.error(`tells make: ${err.message}`);
      process.exit(2);
    }
  }
  const texts = refs.length ? studyPrompts(brief, n, refs, { page, assets: Boolean(assets), current: currentName, style: Boolean(flags.style) }) : prompts(brief, n);
  const dirs = texts.map((_, i) => path.join(out, `v${i + 1}`));
  for (const [i, dir] of dirs.entries()) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PROMPT.md"), texts[i]);
    refs.forEach((r, j) => fs.copyFileSync(r.png, path.join(dir, `reference-${j + 1}.png`)));
    if (assets) fs.cpSync(assets, path.join(dir, "assets"), { recursive: true });
    if (current) fs.copyFileSync(current, path.join(dir, currentName));
  }
  if (flags["dry-run"]) {
    say(`Wrote ${n} prompts to ${display(out)}. Run without --dry-run to build them.`);
    return;
  }
  if (!agent && spawnSync("claude", ["--version"], { encoding: "utf8" }).error) {
    console.error("tells make: Claude Code (`claude`) isn't on your PATH. Install it, or pass --agent \"<command that reads a prompt on stdin>\".");
    process.exit(2);
  }

  say(`${paint.bold("tells make")}  ${brief}`);
  say(paint.dim(`${n} variants in ${display(out)}, agent: ${agent ?? "claude -p"}${flags.model ? ` (${valueOf("model")})` : ""}`));
  if (refs.length) say(paint.dim(`${page} page, studying ${refs.map((r) => r.name).join(", ")}${assets ? `, with assets from ${display(assets)}` : ""}`));
  const runs = {};
  await Promise.all(
    dirs.map(async (dir, i) => {
      const r = await runAgent({ dir, prompt: texts[i], agent, model: valueOf("model"), timeoutMs });
      runs[`v${i + 1}`] = r;
      const made = fs.existsSync(path.join(dir, "index.html"));
      say(`  v${i + 1}  ${made ? paint.green("built") : paint.red("no index.html")}  ${r.seconds}s${r.error ? paint.yellow(`  ${r.error}`) : ""}`);
    }),
  );

  const built = dirs.filter((d) => fs.existsSync(path.join(d, "index.html")));
  if (!built.length) {
    console.error(`tells make: no variant produced index.html. See agent.log in each folder of ${display(out)}.`);
    process.exit(1);
  }
  // The rebuild of a reference is study material, not the variant: keep it out of fix, check and pick.
  for (const d of built) {
    if (fs.existsSync(path.join(d, "study.html"))) {
      fs.mkdirSync(path.join(d, "shots"), { recursive: true });
      fs.renameSync(path.join(d, "study.html"), path.join(d, "shots", "study.html"));
    }
  }
  for (const d of built) spawnSync(process.execPath, [BIN, "fix", d], { stdio: "ignore" });

  say(paint.dim("\nChecking every variant…"));
  const ranked = rank(built.map((d) => measure(d, { render: !flags["no-render"], against, house: valueOf("house"), label: path.basename(d) })));
  fs.writeFileSync(path.join(out, "REPORT.md"), report({ brief, out, ranked, runs, refs }));
  say("");
  printRanking(ranked, paint, say);
  say(`\n${paint.bold("Result:")} ${display(path.join(ranked[0].variant, "index.html"))}`);
  say(paint.dim(`Report: ${display(path.join(out, "REPORT.md"))}`));
  if (ranked[0].errors.length) process.exitCode = 1;
}
