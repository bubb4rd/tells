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
import { intFlag } from "./cli.mjs";

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

/**
 * How to work in a tells run, appended to the default agent's system prompt. In the roaster baseline, 32 of the six
 * agents' turns were refused (shell edits, `mkdir`, `cd … &&`, `T=…; node $T`, redirects) and each re-read
 * tells' source to see how a check works. A refused turn costs a turn, and every turn re-reads all that came before.
 */
export const HABITS = `## How to work in this run

- Change files only with Write and Edit. Write creates any folder it needs. Never sed, python, mkdir, or cat > / >>.
- Bash runs one \`node\` command at a time, from the working folder, with full paths: \`node ${TELLS}/bin/tells.mjs check .\`. Anything else is refused and costs a turn: no \`cd … &&\`, no \`VAR=…;\` prefix, no \`;\` chains, no loops, no \`> file\` redirects.
- If you need a script, Write it inside the working folder, run it with \`node <file>\`, and delete it when you're done. Nothing in /tmp.
- tells' rules are in \`${TELLS}/rules/anti-slop.md\`, and every hit names its rule and its fix. Don't read tells' source (\`src/\`) to work out how a check works: change the page until the check passes, or keep the hit with a \`tells-ok\` and a reason.`;

/** What a Claude Code `result` event says the run cost. */
export function usageOf(result) {
  const u = result?.usage ?? {};
  return {
    costUsd: result?.total_cost_usd ?? null,
    turns: result?.num_turns ?? null,
    apiMs: result?.duration_api_ms ?? null,
    tokens: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Runs one agent in `dir` with the prompt on stdin. The default agent (Claude Code) streams JSON: every event is
 * stamped with the time it arrived and kept in `stream` (default `dir/agent.jsonl`), the final answer goes to
 * `agent.log`, and the result carries what the run cost. A custom --agent writes straight to `agent.log` and
 * reports seconds only. `command` replaces the `claude` binary (for tests).
 */
export function runAgent({ dir, prompt, agent, model, timeoutMs, stream = null, command = ["claude"] }) {
  return new Promise((resolve) => {
    const log = fs.openSync(path.join(dir, "agent.log"), "w");
    const startedAt = Date.now();
    const child = agent
      ? spawn(agent, { cwd: dir, shell: true, stdio: ["pipe", log, log] })
      : spawn(command[0], [
          ...command.slice(1),
          "-p", "--no-session-persistence",
          "--output-format", "stream-json", "--verbose",
          // Only what the agent needs: none of your own hooks, plugins, MCP servers or skills. Each costs tokens
          // on every turn, and a hook that blocks a tool call costs a turn.
          "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands",
          // The same for every agent, so it caches with the rest of the system prompt.
          "--append-system-prompt", HABITS,
          "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(node:*)",
          "--add-dir", TELLS,
          ...(model ? ["--model", model] : []),
        ], { cwd: dir, stdio: ["pipe", "pipe", log] });
    let result = null;
    let jsonl = null;
    let rest = "";
    const take = (text) => {
      const at = Date.now();
      for (const raw of text.split("\n")) {
        if (!raw.trim()) continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          fs.writeSync(log, raw + "\n"); // not an event: keep it readable in the log
          continue;
        }
        fs.writeSync(jsonl, JSON.stringify({ at, ...event }) + "\n");
        if (event.type === "result") result = event;
      }
    };
    if (!agent) {
      const file = stream ?? path.join(dir, "agent.jsonl");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      jsonl = fs.openSync(file, "w");
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop();
        take(lines.join("\n"));
      });
    }
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (jsonl !== null) {
        if (rest) take(rest);
        fs.closeSync(jsonl);
      }
      if (result?.result) fs.writeSync(log, (result.is_error ? "Error: " : "") + String(result.result) + "\n");
      fs.closeSync(log);
      const endedAt = Date.now();
      const seconds = Math.round((endedAt - startedAt) / 1000);
      resolve({
        ...status(seconds),
        seconds,
        started: new Date(startedAt).toISOString(),
        ended: new Date(endedAt).toISOString(),
        ...(result ? usageOf(result) : {}),
        ...(result?.credential_expires_at ? { signInEnds: result.credential_expires_at } : {}),
      });
    };
    child.on("error", (err) => finish(() => ({ ok: false, error: err.code === "ENOENT" ? "agent command not found" : err.message })));
    child.on("close", (code, signal) =>
      finish((seconds) => ({
        ok: code === 0 && !result?.is_error,
        error: signal ? `stopped after ${seconds}s (${signal})` : code ? `exit ${code}` : result?.is_error ? `agent error: ${result.subtype ?? "unknown"}` : null,
      })),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

const kTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** Adds up agent runs: time, cost, tokens. Runs from a custom --agent count for time only. */
export function totalOf(runs) {
  const t = { runs: 0, seconds: 0, costUsd: 0, measured: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  for (const r of runs.filter(Boolean)) {
    t.runs++;
    t.seconds += r.seconds ?? 0;
    if (r.costUsd == null) continue;
    t.measured++;
    t.costUsd += r.costUsd;
    for (const k of Object.keys(t.tokens)) t.tokens[k] += r.tokens?.[k] ?? 0;
  }
  return t;
}

/** "3 agents, 41m, $4.12, 1.2M in (1.1M cached) / 38k out", or time only when nothing was measured. */
export function costLine(runs) {
  const t = totalOf(runs);
  const time = t.seconds >= 60 ? `${Math.round(t.seconds / 60)}m` : `${t.seconds}s`;
  const head = `${t.runs} agent${t.runs === 1 ? "" : "s"}, ${time}`;
  if (!t.measured) return head;
  const { input, output, cacheRead, cacheWrite } = t.tokens;
  const unmeasured = t.runs - t.measured;
  return `${head}, $${t.costUsd.toFixed(2)}, ${kTokens(input + cacheRead + cacheWrite)} in (${kTokens(cacheRead)} cached) / ${kTokens(output)} out${unmeasured ? `, ${unmeasured} not measured` : ""}`;
}

function report({ brief, out, ranked, runs, refs }) {
  const rows = ranked.map((r) => {
    const v = path.basename(r.variant);
    const run = runs[v];
    return `| ${r.rank} | [${v}](${v}/index.html) | ${ruleCount(r.errors)} | ${r.exceptions} | ${r.lands.length ? r.lands.join(", ") : "no"} | ${r.houseOf ? `${r.houseAxes}/${r.houseOf}` : "–"} | ${r.warnings.length} | ${run?.seconds ?? "–"}s${run?.costUsd != null ? `, $${run.costUsd.toFixed(2)}` : ""} |`;
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
    `Agents: ${costLine(Object.values(runs))}.`,
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
  if (argv.includes("--product") || argv.includes("--resume") || argv.includes("--from")) return (await import("./product.mjs")).run(argv);
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
  const n = intFlag("variants", valueOf("variants"), { min: 2, max: 12, fallback: 4 });
  const out = path.resolve(valueOf("out") ?? path.join("tells-make", `${slug(brief)}-${stamp()}`));
  const agent = valueOf("agent");
  const timeoutMs = intFlag("timeout", valueOf("timeout"), { min: 1, max: 600, fallback: refSpecs.length || kinds.length ? 40 : 20 }) * 60_000;
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
      say(`  v${i + 1}  ${made ? paint.green("built") : paint.red("no index.html")}  ${r.seconds}s${r.costUsd != null ? `, $${r.costUsd.toFixed(2)}` : ""}${r.error ? paint.yellow(`  ${r.error}`) : ""}`);
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
