/**
 * tells make: brief in, one checked design out, with no picks in between.
 *
 * Usage:
 *   tells make "<brief>" [--variants 4] [--out <dir>] [--agent "<command>"] [--model <id>]
 *                        [--against <path>]... [--house <path>] [--no-render] [--timeout <minutes>] [--dry-run]
 *
 * 1. Writes one prompt per variant (src/make.prompt.md), each with a different angle on the subject.
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

function runAgent({ dir, prompt, agent, model, timeoutMs }) {
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

function report({ brief, out, ranked, runs }) {
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
    "## Angles",
    "",
    ...ranked.map((r) => `- **${path.basename(r.variant)}:** ${ANGLES[(Number(path.basename(r.variant).slice(1)) - 1) % ANGLES.length]}`),
    "",
    `Chosen by \`tells pick\`: fewest rules broken, then fewest written exceptions, then off the cliché clusters and your house style. Warnings are shown but don't decide. No taste model; see playbook/taste.md.`,
    "",
  ].join("\n");
}

export async function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const valueOf = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : typeof flags[name] === "string" ? flags[name] : null;
  };
  const against = argv.flatMap((a, i) => (a === "--against" && argv[i + 1] ? [argv[i + 1]] : []));
  const values = new Set([valueOf("variants"), valueOf("out"), valueOf("agent"), valueOf("model"), valueOf("house"), valueOf("timeout"), ...against].filter(Boolean));
  const brief = positional.filter((p) => !values.has(p)).join(" ").trim();
  if (!brief) {
    console.error('tells make: give it a brief, e.g. tells make "a booking screen for a bike repair shop"');
    process.exit(2);
  }
  const n = Math.max(2, Math.min(12, Number(valueOf("variants")) || 4));
  const out = path.resolve(valueOf("out") ?? path.join("tells-make", `${slug(brief)}-${stamp()}`));
  const agent = valueOf("agent");
  const timeoutMs = (Number(valueOf("timeout")) || 20) * 60_000;
  const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const say = (s) => process.stdout.write(s + "\n");

  const texts = prompts(brief, n);
  const dirs = texts.map((_, i) => path.join(out, `v${i + 1}`));
  for (const [i, dir] of dirs.entries()) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PROMPT.md"), texts[i]);
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
  for (const d of built) spawnSync(process.execPath, [BIN, "fix", d], { stdio: "ignore" });

  say(paint.dim("\nChecking every variant…"));
  const ranked = rank(built.map((d) => measure(d, { render: !flags["no-render"], against, house: valueOf("house"), label: path.basename(d) })));
  fs.writeFileSync(path.join(out, "REPORT.md"), report({ brief, out, ranked, runs }));
  say("");
  printRanking(ranked, paint, say);
  say(`\n${paint.bold("Result:")} ${display(path.join(ranked[0].variant, "index.html"))}`);
  say(paint.dim(`Report: ${display(path.join(out, "REPORT.md"))}`));
  if (ranked[0].errors.length) process.exitCode = 1;
}
