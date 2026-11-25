/**
 * tells consistent: the screens of one product should read as one system.
 *
 * Usage:
 *   tells consistent <dir|files|urls...> [--lead <file>]... [--json] [--strict] [--theme light|dark]
 *
 * `same` asks whether a design is its own; inside one product the opposite holds. This renders every screen
 * at 1440px and compares what a system fixes: typefaces, heading sizes, the page, the panel, the chart mark,
 * the shell and the accent. Each screen is compared with the system, which is what most screens share, or
 * what the screens named with --lead share (the approved ones).
 *
 * Allow a drift with `.tellsrc` "allow", or data-tells-ok on the page, with a reason. Exit 1 on any error.
 */
import fs from "node:fs";
import path from "node:path";
import { display, makePaint, parseArgs } from "./check.mjs";
import { fingerprintPages } from "./render.mjs";
import { themeOf } from "./cdp.mjs";
import { configFor } from "./config.mjs";

export const RULES = [
  { id: "drift-typeface", severity: "error", fix: "Use the system's typefaces. A product gets one family for text and numbers, at most one more for display." },
  { id: "drift-heading", severity: "warn", fix: "Use the system's heading sizes; the same level is the same size on every screen." },
  { id: "drift-page", severity: "error", fix: "Every screen sits on the same page colour." },
  { id: "drift-panel", severity: "error", fix: "Use the system's panel: same radius, surface and line on every screen." },
  { id: "one-shape", severity: "warn", fix: "Every screen draws its data with the same one mark. Share the chart language (axis, labels, tooltip, colours), not the shape: draw each screen's main object the way it works (a day as a timeline, a process as stages, a level running down to a date)." },
  { id: "drift-shell", severity: "error", fix: "Every screen sits in the same shell (navigation and layout)." },
  { id: "drift-accent", severity: "warn", fix: "This screen brings in a colour the system doesn't use. Use the system's accent, or the system's status colours." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

const SKIP = /(?:^|[\\/])(?:shots|references|work|node_modules|\.git)(?:[\\/]|$)|(?:^|[\\/])(?:study|reference[\w-]*)\.html$/i;
const MONO = /\b(?:mono|monospace|courier|menlo|consolas|sf mono|jetbrains|fira code|ibm plex mono|geist mono|roboto mono)\b/i;

function htmlFiles(target, out) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat) {
    process.stderr.write(`tells consistent: skipping missing path ${display(target)}\n`);
    return;
  }
  if (stat.isFile()) {
    if (/\.html$/i.test(target)) out.push(target);
    return;
  }
  for (const e of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(target, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) htmlFiles(p, out);
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
}

/** The value most screens share; ties go to the earliest screen. */
function majority(values) {
  const counts = new Map();
  for (const v of values) if (v !== null && v !== undefined) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)) best = v;
  return best;
}

const hexRgb = (h) => (h && h !== "none" ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
const dist = (a, b) => (a && b ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : a || b ? 255 : 0);
const rgbKey = (c) => (c ? "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : null);
const hueGroup = (h) => Math.round(h / 30) % 12;

/** What the system fixes, read from one screen's fingerprint. */
export function traits(fp) {
  const sys = fp.system ?? {};
  const total = Object.values(sys.families ?? {}).reduce((a, b) => a + b, 0) || 1;
  const families = Object.entries(sys.families ?? {})
    .filter(([f, n]) => n / total >= 0.05 && !MONO.test(f))
    .map(([f]) => f.toLowerCase());
  const charts = sys.charts ?? {};
  const marks = ["dots", "bars", "lines", "canvas"].filter((k) => charts[k] > 0);
  return {
    families,
    h1: sys.h1 ?? null,
    h2: sys.h2 ?? null,
    page: fp.page ?? null,
    panel: sys.panel ?? null,
    marks,
    layout: fp.layout ?? null,
    accents: [...new Set((fp.accents ?? []).filter((a) => a.area >= 0.002).map((a) => hueGroup(a.h)))],
  };
}

/** Compare every screen with the system. Pure: takes [{label, traits}], returns hits. */
export function compare(screens, leadLabels = []) {
  const basis = leadLabels.length ? screens.filter((s) => leadLabels.includes(s.label)) : screens;
  const base = basis.length ? basis : screens;
  const familyShare = new Map();
  for (const s of base) for (const f of s.traits.families) familyShare.set(f, (familyShare.get(f) || 0) + 1);
  const sysFamilies = new Set([...familyShare].filter(([, n]) => n >= Math.max(1, base.length / 2)).map(([f]) => f));
  const markShare = new Map();
  for (const s of base) for (const m of s.traits.marks) markShare.set(m, (markShare.get(m) || 0) + 1);
  const sysMark = [...markShare].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const accentShare = new Map();
  for (const s of base) for (const a of s.traits.accents) accentShare.set(a, (accentShare.get(a) || 0) + 1);
  const sysAccents = new Set(accentShare.keys());
  const system = {
    families: [...sysFamilies],
    h1: majority(base.map((s) => s.traits.h1)),
    h2: majority(base.map((s) => s.traits.h2)),
    page: majority(base.map((s) => rgbKey(s.traits.page))),
    panel: majority(base.map((s) => (s.traits.panel ? JSON.stringify(s.traits.panel) : null))),
    mark: sysMark,
    layout: majority(base.map((s) => s.traits.layout)),
  };
  const panel = system.panel ? JSON.parse(system.panel) : null;

  const hits = [];
  const add = (s, rule, detail) => hits.push({ target: s.label, rule, severity: RULE_BY_ID.get(rule).severity, detail, fix: RULE_BY_ID.get(rule).fix });
  for (const s of screens) {
    const t = s.traits;
    const extra = t.families.filter((f) => !sysFamilies.has(f));
    if (extra.length) add(s, "drift-typeface", `${extra.join(", ")} (system: ${system.families.join(", ") || "none"})`);
    if (system.h1 !== null && t.h1 !== null && Math.abs(t.h1 - system.h1) > 1) add(s, "drift-heading", `h1 ${t.h1}px (system: ${system.h1}px)`);
    if (system.h2 !== null && t.h2 !== null && Math.abs(t.h2 - system.h2) > 1) add(s, "drift-heading", `h2 ${t.h2}px (system: ${system.h2}px)`);
    if (system.page && t.page && dist(hexRgb(system.page), t.page) > 6) add(s, "drift-page", `${rgbKey(t.page)} (system: ${system.page})`);
    if (panel && t.panel) {
      const off = [];
      if (Math.abs(t.panel.radius - panel.radius) > 1) off.push(`radius ${t.panel.radius}px vs ${panel.radius}px`);
      if (dist(hexRgb(t.panel.bg), hexRgb(panel.bg)) > 6) off.push(`surface ${t.panel.bg} vs ${panel.bg}`);
      if (dist(hexRgb(t.panel.border), hexRgb(panel.border)) > 10) off.push(`line ${t.panel.border} vs ${panel.border}`);
      if (off.length) add(s, "drift-panel", off.join(", "));
    }
    if (system.layout && t.layout && t.layout !== system.layout) add(s, "drift-shell", `${t.layout} (system: ${system.layout})`);
    const newHues = t.accents.filter((a) => !sysAccents.has(a));
    if (newHues.length && sysAccents.size) add(s, "drift-accent", `hue ${newHues.map((h) => h * 30 + "°").join(", ")} isn't in the system`);
  }
  // The opposite drift: a product of three or more screens that draws everything with the same one mark.
  const only = screens.length >= 3 && screens.every((s) => s.traits.marks.length === 1 && s.traits.marks[0] === screens[0].traits.marks[0] && s.traits.marks[0] !== "canvas");
  if (only) for (const s of screens) if (!leadLabels.includes(s.label)) add(s, "one-shape", `only ${s.traits.marks[0]}, like every other screen`);
  return { system, hits };
}

export async function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  if (flags.rules) {
    for (const r of RULES) console.log(`${r.id.padEnd(16)} ${r.severity.padEnd(6)} ${r.fix}`);
    return;
  }
  const leads = argv.flatMap((a, i) => (a === "--lead" && argv[i + 1] && !argv[i + 1].startsWith("--") ? [argv[i + 1]] : []));
  const toTarget = (inp) => {
    if (/^https?:\/\//i.test(inp)) return [{ id: inp, kind: "url", url: inp, label: inp }];
    if (inp.includes("#")) {
      // a route in a single-page app: index.html#/inbox
      const file = path.resolve(inp.slice(0, inp.indexOf("#")));
      const hash = inp.slice(inp.indexOf("#"));
      return [{ id: file + hash, kind: "file", file, hash, label: display(file) + hash }];
    }
    const files = [];
    htmlFiles(path.resolve(inp), files);
    return files.map((f) => ({ id: f, kind: "file", file: f, label: display(f) }));
  };
  const inputs = [...new Set([...leads, ...positional.filter((p) => p !== flags.theme)])];
  const targets = [];
  for (const inp of inputs.length ? inputs : ["."]) for (const t of toTarget(inp)) if (!targets.some((x) => x.id === t.id)) targets.push(t);
  const leadLabels = leads.flatMap((l) => toTarget(l).map((t) => t.label));
  if (targets.length < 2) {
    console.error("tells consistent: give it at least two screens of one product.");
    process.exit(2);
  }

  const fps = await fingerprintPages(targets, { theme: themeOf(flags) });
  const screens = targets.filter((t) => fps.get(t.id)).map((t) => ({ label: t.label, file: t.file, traits: traits(fps.get(t.id)), ok: fps.get(t.id).ok ?? [] }));
  const { system, hits: raw } = compare(screens, leadLabels);

  // Exceptions: data-tells-ok on the page, or .tellsrc allow, each with a reason
  const hits = [];
  const allowed = [];
  for (const h of raw) {
    const s = screens.find((x) => x.label === h.target);
    const inPage = s.ok.find((d) => d.rule === h.rule && d.reason);
    const rc = s.file ? configFor(s.file)?.config.allow?.[h.rule] : null;
    if (inPage || rc) allowed.push({ ...h, reason: inPage ? inPage.reason : `.tellsrc: ${rc}` });
    else hits.push(h);
  }

  if (flags.json) {
    console.log(JSON.stringify({ screens: screens.map((s) => ({ target: s.label, traits: s.traits })), system, hits, allowed }, null, 2));
  } else {
    const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
    const out = [];
    out.push(paint.bold("System") + paint.dim(`  from ${leadLabels.length ? leadLabels.join(", ") : `what most of ${screens.length} screens share`}`));
    out.push(`  typefaces  ${system.families.join(", ") || "–"}`);
    out.push(`  headings   h1 ${system.h1 ?? "–"}px, h2 ${system.h2 ?? "–"}px`);
    out.push(`  page       ${system.page ?? "–"}`);
    out.push(`  panel      ${system.panel ? Object.entries(JSON.parse(system.panel)).map(([k, v]) => `${k} ${v}`).join(", ") : "–"}`);
    out.push(`  chart      ${system.mark ?? "none"}`);
    out.push(`  shell      ${system.layout ?? "–"}`);
    out.push("");
    const w = Math.max(...RULES.map((r) => r.id.length));
    for (const s of screens) {
      const mine = hits.filter((h) => h.target === s.label);
      out.push((mine.length ? paint.red("✗ ") : paint.green("✓ ")) + s.label);
      for (const h of mine) out.push(`    ${h.severity === "error" ? paint.red("[error]") : paint.yellow("[warn] ")} ${h.rule.padEnd(w)}  ${h.detail}`);
    }
    if (allowed.length) {
      out.push("", paint.bold("Allowed"));
      for (const a of allowed) out.push(`  ${paint.green("[ok]")} ${a.target}  ${a.rule}  ${a.reason}`);
    }
    const rules = [...new Set(hits.map((h) => h.rule))];
    if (rules.length) {
      out.push("", paint.bold("Fixes"));
      for (const id of rules) out.push(`  ${paint.cyan(id.padEnd(w))}  ${RULE_BY_ID.get(id).fix}`);
    }
    const bad = new Set(hits.filter((h) => h.severity === "error").map((h) => h.target)).size;
    out.push("", bad ? `${bad} of ${screens.length} screens drift from the system.` : paint.green(`${screens.length} screens read as one system.`));
    console.log(out.join("\n"));
  }
  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}
