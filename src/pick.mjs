/**
 * tells pick: choose between design variants with checks, not taste scores.
 *
 * Usage:
 *   tells pick <variant>... [--no-render] [--against <path>]... [--house <path>] [--json]
 *
 * A variant is a folder (or one HTML file). Each one gets `tells check`, `tells render` and
 * `tells same` (against your past designs, never against the other variants), then they're ranked:
 *   1. fewest errors left          (the gate)
 *   2. fewest written exceptions   (tells-ok)
 *   3. off the cliché clusters and your house style, then fewest house axes matched
 *   4. fewest warnings
 * A trained taste model isn't used: on held-out generated rounds it did no better than chance
 * (playbook/taste.md). Close calls are coin flips even for a human picker, so a tie is reported as one.
 * Exit 1 when the winner still has errors.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { display, makePaint, parseArgs } from "./check.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "tells.mjs");

function tells(args) {
  const r = spawnSync(process.execPath, [BIN, ...args, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.stdout || "no output").trim().split("\n").pop() };
  }
}

function htmlIn(target) {
  if (fs.statSync(target).isFile()) return target.endsWith(".html") ? [target] : [];
  const out = [];
  for (const sub of [".", "screens"]) {
    const dir = path.join(target, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".html")) out.push(path.join(dir, f));
  }
  return out;
}

/** Everything the ranking needs about one variant. */
export function measure(variant, { render = true, against = [], house = null, label = null } = {}) {
  const check = tells(["check", variant]);
  const pages = htmlIn(variant);
  const rend = render && pages.length ? tells(["render", ...pages]) : null;
  const sameArgs = ["same", variant, "--no-siblings", ...against.flatMap((a) => ["--against", a]), ...(house ? ["--house", house] : [])];
  const same = tells(sameArgs).designs?.[0] ?? null;

  const hits = [
    ...(check.hits ?? []).map((h) => ({ tool: "check", rule: h.rule, severity: h.severity })),
    ...(rend?.hits ?? []).map((h) => ({ tool: "render", rule: h.rule, severity: h.severity })),
    ...(same?.hits ?? []).map((h) => ({ tool: "same", rule: h.rule, severity: h.severity })),
  ];
  const sameRules = (same?.hits ?? []).map((h) => h.rule);
  return {
    variant: display(variant),
    label: label ?? display(variant),
    errors: hits.filter((h) => h.severity === "error"),
    warnings: hits.filter((h) => h.severity === "warn"),
    exceptions: (check.allowed?.length ?? 0) + (same?.allowed?.length ?? 0),
    lands: sameRules.filter((r) => r.startsWith("cluster-") || r === "house-style"),
    houseAxes: same?.houseMatch ? same.houseMatch.matched.length : 0,
    houseOf: same?.houseMatch ? same.houseMatch.of : 0,
    rendered: Boolean(rend && !rend.error),
    problems: [check.error && `check: ${check.error}`, rend?.error && `render: ${rend.error}`, same?.error && `same: ${same.error}`].filter(Boolean),
    notes: fs.statSync(variant).isDirectory() && fs.existsSync(path.join(variant, "NOTES.md")) ? display(path.join(variant, "NOTES.md")) : null,
  };
}

const KEYS = [
  ["errors left", (m) => m.errors.length],
  ["written exceptions", (m) => m.exceptions],
  ["lands on a default look", (m) => m.lands.length],
  ["house axes matched", (m) => m.houseAxes],
  ["warnings", (m) => m.warnings.length],
];

const list = (hits) => {
  const counts = new Map();
  for (const h of hits) counts.set(`${h.tool}:${h.rule}`, (counts.get(`${h.tool}:${h.rule}`) || 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
};

/** Why `m` ranks below `winner`: the first check where it does worse. */
function reason(m, winner) {
  for (const [name, f] of KEYS) {
    const a = f(m);
    const b = f(winner);
    if (a === b) continue;
    if (name === "errors left") return `${a} error${a === 1 ? "" : "s"} left (${list(m.errors)})`;
    if (name === "written exceptions") return `${a} written exception${a === 1 ? "" : "s"}, against ${b}`;
    if (name === "lands on a default look") return `lands on ${m.lands.join(" and ")}`;
    if (name === "house axes matched") return `closer to your house style: ${a} of ${m.houseOf} axes, against ${b}`;
    return `${a} warning${a === 1 ? "" : "s"}, against ${b} (${list(m.warnings)})`;
  }
  return "tied on every check: a close call, either is fine";
}

export function rank(measured) {
  const sorted = [...measured].sort((x, y) => {
    for (const [, f] of KEYS) if (f(x) !== f(y)) return f(x) - f(y);
    return 0;
  });
  const winner = sorted[0];
  return sorted.map((m, i) => ({ ...m, rank: i + 1, why: i === 0 ? null : reason(m, winner) }));
}

export function printRanking(ranked, paint, out = console.log) {
  const w = Math.max(...ranked.map((r) => r.label.length), 7);
  const lines = [paint.bold(`${"#".padEnd(3)}${"variant".padEnd(w + 2)}${"errors".padStart(7)}${"except".padStart(8)}${"default".padStart(9)}${"house".padStart(7)}${"warn".padStart(6)}`)];
  for (const r of ranked) {
    const house = r.houseOf ? `${r.houseAxes}/${r.houseOf}` : "–";
    const row = `${String(r.rank).padEnd(3)}${r.label.padEnd(w + 2)}${String(r.errors.length).padStart(7)}${String(r.exceptions).padStart(8)}${(r.lands.length ? "yes" : "no").padStart(9)}${house.padStart(7)}${String(r.warnings.length).padStart(6)}`;
    lines.push(r.rank === 1 ? paint.green(row) : row);
  }
  lines.push("");
  const [win, ...rest] = ranked;
  lines.push(`${paint.bold("Winner:")} ${win.label}${win.errors.length ? paint.red(`  (still ${win.errors.length} error${win.errors.length === 1 ? "" : "s"}: ${list(win.errors)})`) : ""}`);
  for (const r of rest) lines.push(`  ${r.label}: ${r.why}`);
  for (const r of ranked) for (const p of r.problems) lines.push(paint.yellow(`  ${r.label}: ${p}`));
  if (!ranked.some((r) => r.rendered)) lines.push(paint.dim("  Not rendered: contrast, overflow and tap targets weren't checked."));
  out(lines.join("\n"));
}

export function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const against = argv.flatMap((a, i) => (a === "--against" && argv[i + 1] ? [argv[i + 1]] : []));
  const house = typeof flags.house === "string" ? flags.house : null;
  const variants = positional.filter((p) => !against.includes(p) && p !== house).filter((p) => {
    if (fs.existsSync(p)) return true;
    process.stderr.write(`tells pick: skipping missing path ${p}\n`);
    return false;
  });
  if (variants.length < 2) {
    console.error("tells pick: give it two or more variants (folders or HTML files).");
    process.exit(2);
  }
  const ranked = rank(variants.map((v) => measure(v, { render: !flags["no-render"], against, house })));
  if (flags.json) console.log(JSON.stringify({ winner: ranked[0].variant, ranking: ranked }, null, 2));
  else printRanking(ranked, makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
  if (ranked[0].errors.length) process.exitCode = 1;
}
