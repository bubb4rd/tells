/**
 * tells fix: rewrite the hits that have one right answer, then report what's left.
 *
 * Usage:
 *   tells fix [paths...] [--dry-run] [--json] [--strict] [--rule <id>] [--radius=<css>]
 *
 * Only open hits are touched. A line allowed with tells-ok stays as it is.
 * Everything a fix can't settle (copy, colour, layout) is left for a person or an agent,
 * and listed in the report that follows. Exit code matches `tells check` on the result.
 */
import fs from "node:fs";
import path from "node:path";
import { RULE_BY_ID, auditFile, walk, display, printReport, makePaint, summarize, parseArgs } from "./check.mjs";

const ROOT = process.cwd();
const MAX_PASSES = 3;

// The properties hover and focus states actually change. Tailwind's `transition` class names the same set.
const TRANSITION_PROPS = ["color", "background-color", "border-color", "opacity", "box-shadow", "transform"];
const CALM_EASE = "cubic-bezier(0.2, 0, 0, 1)";
const REDUCED_MOTION_CSS = [
  "@media (prefers-reduced-motion: reduce) {",
  "  *, *::before, *::after {",
  "    animation-duration: 0.01ms !important;",
  "    animation-iteration-count: 1 !important;",
  "    transition-duration: 0.01ms !important;",
  "    scroll-behavior: auto !important;",
  "  }",
  "}",
];
// Realistic, varied names, picked per file so no single name becomes the new placeholder.
const NAMES = [
  "Priya Raman", "Tomás Ortega", "Ama Mensah", "Lukas Brandt", "Hana Sato", "Diego Ferreira",
  "Noor Haddad", "Elise Moreau", "Kwame Asante", "Mei Lin", "Rafael Souza", "Ingrid Holm",
  "Arjun Mehta", "Zofia Nowak", "Malik Johnson", "Sofia Rossi",
];

const ARROW = String.raw`(?:[→⟶➔➜➝➞↗»›]|&(?:rarr|nearr|raquo|rsaquo);|&#(?:8594|8599|187|8250);|&#x(?:2192|2197|bb|203a);)`;
const TEXT_END = String.raw`(?=\s*(?:<|\{|["'\`]|$))`;

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Swaps each pill-sized token in a radius value, so `9999px 9999px 0 0` keeps its square corners. */
function shrinkRadius(value, { quoted, jsxProp, radius, radiusNumeric }) {
  return value
    .replace(/var\(--[\w-]*(?:pill|capsule|full)[\w-]*(?:\s*,[^)]*)?\)/gi, radius)
    .replace(/(?<![\w.-])(\d+(?:\.\d+)?)(px|rem|em|vh|vw|vmin|vmax|dvh|svh|%)?(?![\w.])/g, (m, n, u) => {
      const x = +n;
      const big = !u ? !quoted && jsxProp && x >= 100 : u === "px" ? x >= 100 : u === "rem" || u === "em" ? x >= 6 : u !== "%" && x >= 50;
      if (!big) return m;
      return !u ? (radiusNumeric ?? `"${radius}"`) : radius;
    });
}

// ---------------------------------------------------------------------------
// Which properties actually change? `transition: all` is replaced by the defaults plus these.

const NOT_ANIMATED = /^(?:cursor|display|content|pointer-events|position|user-select|transition.*|animation.*|will-change|z-index|outline-style|border-style|list-style.*)$/;

/** Tailwind utility (variants stripped) to the CSS properties it sets. */
function utilityProps(token) {
  const c = token.replace(/^.*:/, "").replace(/^[!-]+/, "");
  const table = [
    [/^size-/, ["width", "height"]],
    [/^min-w-/, ["min-width"]], [/^max-w-/, ["max-width"]], [/^w-/, ["width"]],
    [/^min-h-/, ["min-height"]], [/^max-h-/, ["max-height"]], [/^h-/, ["height"]],
    [/^p[xytrblse]?-/, ["padding"]], [/^m[xytrblse]?-/, ["margin"]], [/^gap-/, ["gap"]],
    [/^(?:inset(?:-[xy])?|top|right|bottom|left|start|end)-/, ["top", "right", "bottom", "left"]],
    [/^rounded/, ["border-radius"]],
    [/^(?:scale|translate|rotate|skew)-/, ["transform"]],
    [/^(?:blur|brightness|contrast|grayscale|saturate|sepia|invert|hue-rotate|drop-shadow)/, ["filter"]],
    [/^backdrop-/, ["backdrop-filter"]],
    [/^opacity-/, ["opacity"]],
    [/^bg-/, ["background-color"]],
    [/^text-(?:xs|sm|base|lg|\d?xl|\[\d)/, ["font-size"]],
    [/^text-/, ["color"]],
    [/^border$|^border-\d|^border-\[\d/, ["border-width"]],
    [/^border-/, ["border-color"]],
    [/^(?:shadow|ring)/, ["box-shadow"]],
    [/^outline-/, ["outline-color"]],
    [/^grid-cols-/, ["grid-template-columns"]], [/^grid-rows-/, ["grid-template-rows"]],
    [/^basis-/, ["flex-basis"]], [/^fill-/, ["fill"]], [/^stroke-/, ["stroke"]],
  ];
  for (const [re, props] of table) if (re.test(c)) return props;
  return [];
}

const kebab = (s) => s.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());

/** The source text of the JSX/HTML element whose tag covers line `i`. */
function elementText(lines, i) {
  let start = i;
  while (start > Math.max(0, i - 12) && !/<[A-Za-z]/.test(lines[start])) start--;
  const text = lines.slice(start, start + 30).join("\n");
  const open = text.search(/<[A-Za-z]/);
  if (open === -1) return lines[i];
  let depth = 0;
  let quote = null;
  for (let k = open + 1; k < text.length; k++) {
    const ch = text[k];
    if (quote) {
      if (ch === quote && text[k - 1] !== "\\") quote = null;
      else if (quote === "`" && ch === "$" && text[k + 1] === "{") depth++;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth <= 0) return text.slice(open, k + 1);
  }
  return text.slice(open);
}

/** Properties that change on this element: variant classes, conditional classes, and style={{}} keys. */
function changingPropsForElement(lines, i) {
  const el = elementText(lines, i);
  const props = new Set();
  const tokens = el.split(/[\s"'`{}()?]+/).filter(Boolean);
  const conditional = [...el.matchAll(/\$\{([\s\S]*?)\}\s*`/g)].map((m) => m[1]).join(" ");
  const condTokens = new Set(conditional.split(/[\s"'`{}()?:]+/).filter(Boolean));
  for (const t of tokens) {
    if (/^[\w-]+(?:\[[^\]]*\])?:/.test(t) || condTokens.has(t)) for (const p of utilityProps(t)) props.add(p);
  }
  const style = /\bstyle\s*=\s*\{\{([\s\S]*?)\}\}/.exec(el);
  if (style) for (const m of style[1].matchAll(/(?:^|[,{\s])([a-zA-Z]+)\s*:/g)) props.add(kebab(m[1]));
  return props;
}

/** Properties that change on this CSS rule: anything set by a state rule (:hover, [aria-*], .is-*) on the same selector. */
function changingPropsForRule(raw, lineIndex) {
  const lines = raw.split("\n");
  const offset = lines.slice(0, lineIndex).join("\n").length + 1 + Math.max(0, lines[lineIndex].search(/transition|will-change/));
  const blocks = [...raw.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2], start: m.index, end: m.index + m[0].length }));
  const own = blocks.find((b) => b.start <= offset && offset <= b.end);
  const props = new Set();
  if (!own) return props;
  const STATE = /:(?:hover|focus|focus-visible|focus-within|active|checked|disabled|target|open)\b|\[(?:aria|data)-|\[open\]|\.is-|\.(?:active|open|selected|expanded)\b/;
  const keys = own.selector.split(",").map((s) => (/[.#][\w-]+(?![\s\S]*[.#][\w-]+)/.exec(s.trim()) || [])[0]).filter(Boolean);
  for (const b of blocks) {
    if (b === own || !STATE.test(b.selector)) continue;
    if (!keys.some((k) => new RegExp(`${k.replace(/[.#-]/g, "\\$&")}(?![\\w-])`).test(b.selector))) continue;
    for (const m of b.body.matchAll(/(?:^|[;{\s])(--[\w-]+|[a-z-]+)\s*:/g)) {
      const name = m[1];
      if (name.startsWith("--")) {
        // a state rule that swaps a custom property changes whatever reads it
        for (const u of own.body.matchAll(new RegExp(`(?:^|[;{\\s])([a-z-]+)\\s*:[^;]*var\\(${name}\\b`, "g"))) props.add(u[1]);
      } else props.add(name);
    }
  }
  return props;
}

function transitionList(changing) {
  const extra = [...changing].filter((p) => !NOT_ANIMATED.test(p) && !TRANSITION_PROPS.includes(p));
  return [...TRANSITION_PROPS, ...new Set(extra)];
}

/** Line rewriters. Each takes a line plus the file around it and returns the line changed, or as it was. */
function makeFixers({ radius, file, ext }) {
  const radiusNumeric = /^\d+(?:\.\d+)?px$/.test(radius) ? String(parseFloat(radius)) : null;
  let nameIndex = hash(path.basename(file));
  const nextName = () => NAMES[nameIndex++ % NAMES.length];
  const markup = ext === ".tsx" || ext === ".jsx" || ext === ".mdx" || ext === ".html";

  return {
    "transition-all": (line, { lines, i, raw }) => {
      const inStyleTag = ext === ".html" && /<style[\s>]/i.test(raw.split("\n").slice(0, i + 1).join("\n").replace(/<style[\s\S]*?<\/style>/gi, ""));
      const cssRule = ext === ".css" || inStyleTag;
      const changing = cssRule ? changingPropsForRule(raw, i) : markup ? changingPropsForElement(lines, i) : new Set();
      const props = transitionList(changing);
      const needsList = props.length > TRANSITION_PROPS.length;
      return line
        .replace(/(\btransition\s*:\s*["'`]?)all\b([^;}"'`\n,]*)/g, (_, lead, rest) => {
          const timing = rest.trimEnd();
          return lead + props.map((p) => p + timing).join(", ") + rest.slice(timing.length);
        })
        .replace(/(\btransition-property\s*:\s*["'`]?)all\b/g, `$1${props.join(", ")}`)
        .replace(/(\bwill-change\s*:\s*["'`]?)all\b/g, "$1auto")
        .replace(/\btransition-all\b/g, needsList ? `transition-[${props.join(",")}]` : "transition");
    },

    "bounce-easing": (line) =>
      line
        .replace(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/gi, (m, _x1, y1, _x2, y2) =>
          +y1 < 0 || +y1 > 1 || +y2 < 0 || +y2 > 1 ? CALM_EASE : m,
        )
        .replace(/\b(bounce\s*:\s*)0*(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)\b/g, "$10"),

    "pill-radius": (line) =>
      line
        .replace(
          /((?:border(?:-[a-z-]+)?-radius|--[\w-]*radius[\w-]*|border\w*Radius)\s*:\s*)(["'`]?)([^;{}\n"'`,]+?)\2(?=\s*(?:!important)?\s*(?:[;,}]|$))/gi,
          (m, lead, q, value) => lead + q + shrinkRadius(value, { quoted: Boolean(q), jsxProp: /Radius/.test(lead), radius, radiusNumeric }) + q,
        )
        .replace(/\brounded-full\b/g, (m) => (/avatar/i.test(line) ? m : "rounded-md")),

    // only an arrow that follows text in the same node; a lone arrow (<kbd>→</kbd>) is content
    "arrow-suffix": (line) =>
      line
        .replace(new RegExp(String.raw`([^\s>])(?:[ \t]|&nbsp;)*${ARROW}${TEXT_END}`, "g"), "$1")
        .replace(new RegExp(String.raw`(>\s*|^\s*)${ARROW}(?:\s|&nbsp;)+(?=\D)`, "g"), "$1"),

    "placeholder-copy": (line) => {
      let handle = null;
      const out = line.replace(/\b(?:john|jane)\s+doe\b/gi, () => {
        const name = nextName();
        handle ??= name.toLowerCase().normalize("NFD").replace(/[^\w\s]/g, "").replace(/\s+/g, ".");
        return name;
      });
      return out.replace(/@username\b/g, () => "@" + (handle ?? nextName().split(" ")[0].toLowerCase().normalize("NFD").replace(/[^\w]/g, "")));
    },
  };
}

/** File-level fix: add one reduced-motion block. CSS gets it at the end; HTML inside its last <style>. */
function addReducedMotionGuard(raw, ext) {
  if (ext === ".css") return raw.replace(/\s*$/, "\n\n" + REDUCED_MOTION_CSS.join("\n") + "\n");
  if (ext !== ".html") return null;
  const lastStyle = raw.toLowerCase().lastIndexOf("</style");
  if (lastStyle !== -1) {
    const lineStart = raw.lastIndexOf("\n", lastStyle) + 1;
    const lead = raw.slice(lineStart, lastStyle);
    if (!lead.trim()) {
      // </style> on its own line: indent one step past it, like the rules above
      const block = REDUCED_MOTION_CSS.map((l) => lead + "  " + l).join("\n");
      return raw.slice(0, lineStart) + block + "\n" + raw.slice(lineStart);
    }
    return raw.slice(0, lastStyle) + "\n" + REDUCED_MOTION_CSS.join("\n") + "\n" + raw.slice(lastStyle);
  }
  const head = raw.toLowerCase().indexOf("</head");
  const style = `<style>\n${REDUCED_MOTION_CSS.join("\n")}\n</style>\n`;
  return head === -1 ? style + raw : raw.slice(0, head) + style + raw.slice(head);
}

export const FIXABLE = ["transition-all", "bounce-easing", "pill-radius", "arrow-suffix", "placeholder-copy", "reduced-motion-guard"];

function fixFile(file, { onlyRule, radius }) {
  const ext = path.extname(file);
  const original = fs.readFileSync(file, "utf8");
  let raw = original;
  const fixers = makeFixers({ radius, file, ext });
  const changes = [];

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { hits } = auditFile(file, onlyRule, raw);
    const open = hits.filter((h) => FIXABLE.includes(h.rule));
    if (!open.length) break;
    const lines = raw.split("\n");
    let changed = false;

    for (const h of open) {
      if (h.rule === "reduced-motion-guard") continue;
      const i = h.line - 1;
      const before = lines[i];
      const after = fixers[h.rule](before, { lines, i, raw });
      if (after !== before) {
        lines[i] = after;
        changes.push({ file: display(file), line: h.line, rule: h.rule, before: before.trim(), after: after.trim() });
        changed = true;
      }
    }
    raw = lines.join("\n");

    const guard = open.find((h) => h.rule === "reduced-motion-guard");
    if (guard) {
      const next = addReducedMotionGuard(raw, ext);
      if (next && next !== raw) {
        raw = next;
        changes.push({ file: display(file), line: guard.line, rule: guard.rule, before: "", after: "added @media (prefers-reduced-motion: reduce)" });
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { changed: raw !== original, raw, changes };
}

export function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const onlyRule = typeof flags.rule === "string" ? flags.rule : null;
  if (flags.rule && (!onlyRule || !RULE_BY_ID.has(onlyRule))) {
    console.error(`Error: unknown rule "${onlyRule ?? ""}".`);
    process.exit(2);
  }
  if (onlyRule && !FIXABLE.includes(onlyRule)) {
    console.error(`Error: "${onlyRule}" has no automatic fix. Fixable: ${FIXABLE.join(", ")}`);
    process.exit(2);
  }
  const radius = typeof flags.radius === "string" ? flags.radius : "6px";
  const dry = Boolean(flags["dry-run"]);

  const targets = (positional.length ? positional : ["."]).map((p) => path.resolve(ROOT, p));
  const files = [];
  for (const t of targets) walk(t, files);

  const changes = [];
  const hits = [];
  const allowed = [];
  for (const file of files) {
    const result = fixFile(file, { onlyRule, radius });
    changes.push(...result.changes);
    if (result.changed && !dry) fs.writeFileSync(file, result.raw);
    const after = auditFile(file, null, result.raw);
    hits.push(...after.hits);
    allowed.push(...after.allowed);
  }

  if (flags.json) {
    console.log(JSON.stringify({ dryRun: dry, files: files.map(display), fixed: changes, hits, allowed, summary: summarize(hits, allowed) }, null, 2));
  } else {
    const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
    const out = [];
    if (changes.length) {
      out.push(paint.bold(dry ? "Would fix" : "Fixed") + paint.dim(`  ${changes.length} change${changes.length === 1 ? "" : "s"}`));
      const locWidth = Math.max(...changes.map((c) => `${c.file}:${c.line}`.length));
      const idWidth = Math.max(...changes.map((c) => c.rule.length));
      for (const c of changes) {
        out.push(`  ${paint.dim(`${c.file}:${c.line}`.padEnd(locWidth))}  ${paint.green(c.rule.padEnd(idWidth))}  ${c.after}`);
      }
    } else {
      out.push(paint.dim("Nothing to fix automatically."));
    }
    out.push("");
    console.log(out.join("\n"));
    printReport({ files, hits, allowed }, paint);
  }

  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}
