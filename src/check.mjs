#!/usr/bin/env node
/**
 * tells check: static audit of HTML/CSS/JSX/TSX/MDX source, and scripts that build HTML in strings,
 * for the tells in rules/anti-slop.md.
 *
 * Usage:
 *   tells check [paths...] [--json] [--strict] [--rule <id>]
 *
 * Defaults to the current directory. Exits 1 on any error (with --strict, on any warning too).
 * Suppress one hit with a comment on the same line or the line above:
 *   <!-- tells-ok: glass dropdown sits over live content -->
 *   /* tells-ok: pill-radius avatar is a circle *\/
 * `slop-ok:` is accepted as an alias.
 */
import fs from "node:fs";
import path from "node:path";
import { configFor, shortcutsIn } from "./config.mjs";

const ROOT = process.cwd();
const DEFAULT_PATHS = ["."];
const EXTENSIONS = new Set([".html", ".css", ".tsx", ".jsx", ".mdx", ".js", ".mjs", ".cjs", ".ts"]);
// Plain scripts are read only when they build UI: JSX, or HTML in string or template literals.
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
// JSX, or a line that opens a quoted or template string with a tag: '<div class="x">', `<li>${y}</li>`
const JSX_IN_SCRIPT = /(?:return|=>)\s*\(?\s*<[A-Za-z][\w.]*[\s>/]/;
const TAG_IN_STRING = /(['"`])\s*<\/?[a-z][\w-]*(?:\s[^<>]*)?>/i;
const MIN_MARKUP_LINES = 5; // a script with a stray '<kbd>' in a help string isn't a UI file
const buildsUi = (file) => {
  if (!SCRIPT_EXTENSIONS.has(path.extname(file))) return true;
  if (/\.min\.[cm]?js$|\.(?:test|spec)\.[cm]?[jt]s$|\.d\.ts$/.test(file) || /(?:^|[\\/])__tests__[\\/]/.test(file)) return false;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  if (text.length > 2_000_000 || text.split("\n", 400).some((l) => l.length > 3000)) return false; // bundled or minified
  const code = stripLineComments(stripBlockComments(text));
  if (JSX_IN_SCRIPT.test(code)) return true;
  let n = 0;
  for (const line of code.split("\n")) if (TAG_IN_STRING.test(line) && ++n >= MIN_MARKUP_LINES) return true;
  return false;
};
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage", "vendor", "shots"]);
const GRADIENT_LIMIT = 6;
const EM_DASH_LIMIT = 1;
const CATEGORIES = ["copy", "type", "color", "components", "layout", "decoration", "motion", "meta"];

const RULES = [
  // copy
  { id: "eyebrow-copy", category: "copy", severity: "error", fix: "Drop the eyebrow. If the info matters, put it in the heading or a real metadata line the reader uses." },
  { id: "decorative-data", category: "copy", severity: "warn", fix: "Keep data only if the screen's user reads and acts on it; invented precision is texture." },
  { id: "status-theatre", category: "copy", severity: "error", fix: "Remove LIVE/BETA/NEW badges and status lines on things that have no status." },
  { id: "fake-shortcut", category: "copy", severity: "error", fix: "Remove ⌘K / ↵ hints unless the shortcut actually exists." },
  { id: "dot-triplet", category: "copy", severity: "error", fix: "Tagline rhythm (\"Fast · Secure · Simple\"). Write a sentence that says what it is." },
  { id: "dot-separator", category: "copy", severity: "warn", fix: "Dot + label reads as an eyebrow. Make it a real metadata line or cut it." },
  { id: "em-dash", category: "copy", severity: "warn", fix: "At most one em-dash per screen. Rewrite with a full stop or comma." },
  { id: "arrow-suffix", category: "copy", severity: "error", fix: "Drop the arrow suffix. Buttons name the actual action." },
  { id: "generic-cta", category: "copy", severity: "error", fix: "Not \"Get started\" / \"Learn more\" / \"Explore\". Buttons name the actual action." },
  { id: "meta-copy", category: "copy", severity: "warn", fix: "The page narrates itself. Demonstrate instead; explanation belongs in DESIGN.md." },
  { id: "spec-adjective", category: "copy", severity: "warn", fix: "Cut the adjective. A spec sentence is a rule or a reason." },
  { id: "placeholder-copy", category: "copy", severity: "error", fix: "Replace placeholder names/copy (John/Jane Doe, @username, lorem ipsum, TODO) with realistic product data." },
  // type
  { id: "tracked-caps", category: "type", severity: "warn", fix: "Uppercase + letter-spacing on small labels is default-off. Use sentence case and the system's own hierarchy." },
  { id: "uppercase", category: "type", severity: "warn", fix: "Uppercase is default-off. Justify it or use sentence case." },
  { id: "gradient-text", category: "type", severity: "error", fix: "Gradient text: never. Use a solid colour." },
  { id: "italic-accent", category: "type", severity: "error", fix: "Drop the italic accent word. The headline says what the thing is or does." },
  { id: "default-font", category: "type", severity: "warn", fix: "Default face. Justify it from the subject and name 2 rejected alternatives, or choose another." },
  // color
  { id: "purple-default", category: "color", severity: "error", fix: "Purple/indigo is a default, not a choice. Derive the colour from the subject; every colour needs an origin." },
  { id: "gradient-count", category: "color", severity: "warn", fix: `More than ${GRADIENT_LIMIT} gradients. Each one needs a reason; remove the decorative ones.` },
  // components
  { id: "pill-radius", category: "components", severity: "error", fix: "No pills or capsules. Use the system's own radius." },
  { id: "glass", category: "components", severity: "error", fix: "No backdrop-filter except over real content (menus, overlays)." },
  { id: "emoji-sparkle", category: "components", severity: "error", fix: "No emoji or sparkle icons. One consistent icon set, or none." },
  { id: "side-tab", category: "components", severity: "error", fix: "No coloured left-border stripe on a callout or an active item (as a border or an inset shadow). Use spacing, typography or the system's own surface hierarchy." },
  // layout
  { id: "numbered-section", category: "layout", severity: "warn", fix: "Numbered sections (\"01 / PALETTE\") are bento-by-default. Let content order carry the sequence." },
  // decoration
  { id: "glow-blur", category: "decoration", severity: "error", fix: "Remove blurred blobs, orbs and radial glows." },
  // motion
  { id: "ambient-motion", category: "motion", severity: "error", fix: "No ambient looping motion. One purposeful transition tied to a user action, gated by prefers-reduced-motion." },
  { id: "bounce-easing", category: "motion", severity: "error", fix: "No bounce/overshoot easing (cubic-bezier y outside [0,1] or non-zero spring bounce). Use ease-out or cubic-bezier(0.2, 0, 0, 1)." },
  { id: "transition-all", category: "motion", severity: "warn", fix: "Name the exact animated properties; never use transition: all or will-change: all." },
  { id: "reduced-motion-guard", category: "motion", severity: "warn", fix: "Gate keyframes and movement/scale/filter animations behind prefers-reduced-motion, motion-safe:, or MotionConfig." },
  // meta
  { id: "ok-reason", category: "meta", severity: "error", fix: "Every exception is written down: tells-ok: <rule-id> <reason>." },
  { id: "ok-unknown", category: "meta", severity: "error", fix: "tells-ok names a rule id that doesn't exist. Check `tells rules`." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// Rule IDs owned by render, same, consistent and click, so `tells-ok` for them isn't flagged as ok-unknown.
const OTHER_TOOL_RULES = new Set([
  // render
  "horizontal-overflow", "clipped-text", "cramped-padding", "off-centre-label", "tall-top-nav",
  "icon-feature-grid", "stat-strip", "template-hero-stack", "word-only-screen",
  "low-contrast", "accent-rainbow", "tiny-text", "long-measure",
  "flat-type-hierarchy", "missing-tabular-nums", "mono-costume", "eyebrow-label", "small-tap-target",
  "concentric-radius", "split-surface", "segmented-thumb", "nested-cards", "broken-image",
  "duplicate-avatar", "skipped-heading", "missing-focus-ring",
  // same
  "cluster-warm-paper", "cluster-acid-dark", "cluster-neo-swiss", "cluster-glow-void",
  "cluster-soft-commerce", "house-style", "token-copy",
  // consistent
  "drift-typeface", "drift-heading", "drift-page", "drift-panel", "one-shape", "drift-shell", "drift-accent",
  // click
  "script-error", "click-error", "dead-control", "broken-link",
]);

const DEFAULT_FONTS = [
  "Plus Jakarta Sans", "Instrument Serif", "IBM Plex Mono", "JetBrains Mono", "Space Grotesk",
  "Instrument Sans", "Public Sans", "Geist Mono", "Newsreader", "Fraunces", "DM Sans", "Manrope", "Geist", "Inter", "Syne",
];
const FONT_RE = new RegExp(`\\b(?:${DEFAULT_FONTS.map((f) => f.replace(/ /g, "[\\s+]")).join("|")})\\b`, "g");
const FONT_CONTEXT_RE = /font-family|fontFamily|\bfont\s*:|--font[\w-]*\s*:|fonts\.googleapis|fonts\.bunny|next\/font|@import|family=/i;

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", middot: "·",
  rarr: "→", larr: "←", nearr: "↗", hellip: "…", times: "×", copy: "©", deg: "°", prime: "′",
  Prime: "″", bull: "•", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", raquo: "»", rsaquo: "›",
};

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [k, ...rest] = arg.slice(2).split("=");
      if (rest.length) flags[k] = rest.join("=");
      else if ((k === "rule" || k === "radius" || k === "house" || k === "against" || k === "theme") && argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function walk(target, out) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    process.stderr.write(`tells: skipping missing path ${display(target)}\n`);
    return;
  }
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(target)) && buildsUi(target)) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(target, entry.name), out);
    } else if (EXTENSIONS.has(path.extname(entry.name)) && buildsUi(path.join(target, entry.name))) {
      out.push(path.join(target, entry.name));
    }
  }
}

// ---------------------------------------------------------------------------
// Text helpers

const display = (p) => {
  const rel = path.relative(ROOT, p);
  return !rel ? "." : rel.startsWith("..") ? p : rel;
};

const blank = (s) => s.replace(/[^\n]/g, " ");

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

function stripBlockComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, blank);
}

function stripLineComments(s) {
  return s.replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}

/**
 * Splits an HTML document into two views with identical offsets:
 *  - code:    tags, <style> and <script> kept; text and comments blanked
 *  - visible: text nodes kept; tags replaced by \u0001 separators; everything else blanked
 */
function splitHtml(raw) {
  const lower = raw.toLowerCase();
  const n = raw.length;
  let code = "";
  let vis = "";
  let i = 0;
  while (i < n) {
    if (raw.startsWith("<!--", i)) {
      const end = raw.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      const b = blank(raw.slice(i, stop));
      code += b;
      vis += b;
      i = stop;
      continue;
    }
    if (raw[i] === "<" && /[a-zA-Z/!?]/.test(raw[i + 1] || "")) {
      let j = i + 1;
      let quote = null;
      while (j < n) {
        const c = raw[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      const tag = raw.slice(i, stop);
      code += tag;
      // placeholder text is visible copy; keep it on the tag's last line
      const ph = /\bplaceholder\s*=\s*"([^"]*)"/i.exec(tag);
      let tagVis = tag.replace(/[^\n]/g, "\u0001");
      if (ph && !tag.includes("\n") && tag.length >= ph[1].length + 2) {
        tagVis = "\u0001" + ph[1].padEnd(tag.length - 2, " ") + "\u0001";
      }
      vis += tagVis;
      i = stop;
      const name = (/^<([a-zA-Z][\w-]*)/.exec(tag) || [])[1]?.toLowerCase();
      if ((name === "script" || name === "style") && !tag.endsWith("/>")) {
        const close = lower.indexOf(`</${name}`, i);
        const end = close === -1 ? n : close;
        code += raw.slice(i, end);
        vis += blank(raw.slice(i, end));
        i = end;
      }
      continue;
    }
    code += raw[i] === "\n" ? "\n" : " ";
    vis += raw[i];
    i++;
  }
  return { code: stripLineComments(stripBlockComments(code)), vis };
}

function visibleFromHtml(vis) {
  return vis.split("\n").map((line) => {
    const segments = line
      .split(/\u0001+/)
      .map((s) => decodeEntities(s).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return segments;
  });
}

/** Pragmatic JSX text extraction, one array of segments per line. */
function visibleFromJsx(codeLines) {
  const out = [];
  const isCodey = (s) => /&&|\|\||[=;]|\breturn\b/.test(s);
  const collapse = (s) => {
    let prev;
    do {
      prev = s;
      s = s.replace(/\{[^{}]*\}/g, (m) => {
        const str = /^\{\s*(["'`])((?:(?!\1).)*)\1\s*\}$/.exec(m);
        return str ? str[2] : "{}";
      });
    } while (s !== prev);
    return s;
  };
  for (let i = 0; i < codeLines.length; i++) {
    const segs = [];
    const line = codeLines[i];
    const flat = collapse(line);
    const trimmed = flat.trim();
    const add = (s) => {
      s = decodeEntities(s).replace(/\s+/g, " ").trim();
      if (s && s !== "{}" && !isCodey(s)) segs.push(s);
    };
    for (const m of flat.matchAll(/>([^<>]+)</g)) add(m[1]);
    if (/^<[A-Za-z]/.test(trimmed)) {
      const m = /[^=]>([^<>]+)$/.exec(flat);
      if (m) add(m[1]);
    }
    {
      const m = /^([^<>]+)<\//.exec(trimmed);
      if (m) add(m[1]);
    }
    if (trimmed && !/[<>()=;]/.test(trimmed) && !/^[{}()\[\],]+$/.test(trimmed)) {
      let p = i - 1;
      while (p >= 0 && !codeLines[p].trim()) p--;
      const prev = p >= 0 ? codeLines[p].trim() : "";
      if (prev.endsWith(">") && !prev.endsWith("=>")) add(flat);
    }
    for (const m of line.matchAll(/\b(?:placeholder|title|alt|label)\s*=\s*"([^"]*)"/g)) add(m[1]);
    for (const m of line.matchAll(/\b(?:label|title|text|caption|cta|heading|subtitle|summary|description|eyebrow|tagline|badge|kicker|glyph)\s*:\s*(["'`])((?:(?!\1).)*)\1/g)) add(m[2]);
    out.push([...new Set(segs)]);
  }
  return out;
}

/**
 * Visible text from HTML built in string and template literals ('<h1>' + title + '</h1>', `<p>${x}</p>`).
 * Per line, literal contents are kept and code between them becomes a separator; lines whose literals hold
 * a tag are read as markup.
 */
function visibleFromScriptStrings(codeLines) {
  let inTemplate = false;
  let templateHasTag = false;
  return codeLines.map((line) => {
    let lit = "";
    let quote = inTemplate ? "`" : null;
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (!quote) {
        if (c === "'" || c === '"' || c === "`") quote = c;
        else lit += "\u0001";
        continue;
      }
      if (c === "\\") {
        lit += line[i + 1] ?? "";
        i++;
      } else if (quote === "`" && c === "$" && line[i + 1] === "{") {
        depth = 1;
        i += 2;
        while (i < line.length && depth) {
          if (line[i] === "{") depth++;
          else if (line[i] === "}") depth--;
          i++;
        }
        i--;
        lit += "\u0001";
      } else if (c === quote) {
        quote = null;
        lit += "\u0001";
      } else lit += c;
    }
    const wasTemplate = inTemplate;
    inTemplate = quote === "`";
    const hasTag = /<\/?[a-z][\w-]*[\s>/\u0001]/i.test(lit);
    if (hasTag) templateHasTag = true;
    const markup = hasTag || ((wasTemplate || inTemplate) && templateHasTag);
    if (!inTemplate) templateHasTag = false;
    if (!markup) return [];
    return lit
      .replace(/<[^<>]*>/g, "\u0001")
      .split(/\u0001+/)
      .map((t) => decodeEntities(t).replace(/\s+/g, " ").trim())
      .filter((t) => t && !/[<>]/.test(t));
  });
}

function visibleFromMdx(raw) {
  const lines = raw.split("\n");
  let inFence = false;
  let inFront = lines[0]?.trim() === "---";
  return lines.map((line, i) => {
    const t = line.trim();
    if (inFront) {
      if (i > 0 && t === "---") inFront = false;
      return [];
    }
    if (t.startsWith("```")) {
      inFence = !inFence;
      return [];
    }
    if (inFence || /^(import|export)\s/.test(t)) return [];
    const text = decodeEntities(line.replace(/<[^>]*>/g, "\u0001").replace(/\{[^{}]*\}/g, "\u0001"));
    return text.split(/\u0001+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  });
}

// ---------------------------------------------------------------------------
// Colour helpers

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const isPurpleHsl = ({ h, s, l }) => h >= 235 && h <= 290 && s >= 0.45 && l >= 0.3 && l <= 0.85;

function findPurple(line) {
  for (const m of line.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi)) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex.slice(0, 3)].map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
    if (isPurpleHsl(rgbToHsl(r, g, b))) return m.index;
  }
  for (const m of line.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) {
    if (isPurpleHsl(rgbToHsl(+m[1], +m[2], +m[3]))) return m.index;
  }
  for (const m of line.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/gi)) {
    if (isPurpleHsl({ h: +m[1], s: +m[2] / 100, l: +m[3] / 100 })) return m.index;
  }
  for (const m of line.matchAll(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/gi)) {
    const L = m[2] ? +m[1] / 100 : +m[1];
    if (+m[4] >= 270 && +m[4] <= 315 && +m[3] >= 0.1 && L >= 0.35 && L <= 0.85) return m.index;
  }
  const tw = /\b(?:bg|text|from|via|to|border|ring|fill|stroke|shadow|outline|decoration|accent|caret)-(?:indigo|violet|purple)-\d{2,3}\b/.exec(line);
  return tw ? tw.index : -1;
}

// ---------------------------------------------------------------------------
// Detectors

const UPPER_RE = /text-transform\s*:\s*uppercase|textTransform\s*:\s*["'`]uppercase|font-variant(?:-caps)?\s*:\s*(?:all-)?small-caps/;
const TRACK_RE = /letter-spacing\s*:\s*([^;}\n]+)|letterSpacing\s*:\s*([^,}\n]+)/g;

function hasPositiveTracking(body) {
  for (const m of body.matchAll(TRACK_RE)) {
    const v = (m[1] ?? m[2]).trim().replace(/^["'`]|["'`]$/g, "").trim();
    if (/^var\(/.test(v)) {
      if (!/tight|neg|display|head|title|h[1-6]\b/i.test(v)) return true;
      continue;
    }
    const num = parseFloat(v);
    if (Number.isFinite(num) && num > 0) return true;
  }
  return false;
}

/** Innermost {...} blocks with their selector text and body offset. */
function innermostBlocks(code) {
  const blocks = [];
  const stack = [];
  let boundary = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ open: i, selector: code.slice(boundary, i), hasChild: false });
      boundary = i + 1;
    } else if (c === "}") {
      const top = stack.pop();
      if (top && !top.hasChild) blocks.push({ selector: top.selector.trim(), body: code.slice(top.open + 1, i), offset: top.open + 1 });
      boundary = i + 1;
    } else if (c === ";") {
      boundary = i + 1;
    }
  }
  return blocks;
}

function checkCaps(ctx, body, offset, selector = null) {
  const up = UPPER_RE.exec(body);
  if (!up) return;
  const at = offset + up.index;
  const sel = selector && /^[\w\s.#:>+~*\[\]="'(),-]+$/.test(selector) ? selector.replace(/\s+/g, " ").slice(-48) : null;
  if (hasPositiveTracking(body)) ctx.emit("tracked-caps", ctx.lineOf(at), ctx.colOf(at), sel);
  else ctx.emit("uppercase", ctx.lineOf(at), ctx.colOf(at), sel);
}

/** A full radius on a square box draws a circle (icon button, dot, avatar), which isn't a pill. */
function isSquareClasses(line) {
  if (/(?:^|[\s"'`])(?:size-\S+|aspect-square)(?=[\s"'`]|$)/.test(line)) return true;
  const w = /(?:^|[\s"'`])w-(\S+?)(?=[\s"'`]|$)/.exec(line);
  const h = /(?:^|[\s"'`])h-(\S+?)(?=[\s"'`]|$)/.exec(line);
  return Boolean(w && h && w[1] === h[1] && w[1] !== "full" && w[1] !== "auto");
}

function isSquareBlock(body) {
  if (/aspect-ratio\s*:\s*1(?:\s*\/\s*1)?\s*(?:[;}]|$)/.test(body)) return true;
  const w = /(?:^|[\s;{])width\s*:\s*([^;}\n]+)/.exec(body);
  const h = /(?:^|[\s;{])height\s*:\s*([^;}\n]+)/.exec(body);
  return Boolean(w && h && w[1].trim() === h[1].trim() && !/auto|%|fit|content/.test(w[1]));
}

function detectBlocks(ctx) {
  const code = ctx.ext === ".tsx" || ctx.ext === ".jsx" ? ctx.code.replace(/\$\{[^{}]*\}/g, blank) : ctx.code;
  for (const block of innermostBlocks(code)) {
    if (isSquareBlock(block.body)) {
      const first = ctx.lineOf(block.offset);
      const last = ctx.lineOf(block.offset + block.body.length);
      for (let l = first; l <= last; l++) ctx.circleLines.add(l);
    }
    checkCaps(ctx, block.body, block.offset, block.selector);
    if (/(?:^|[\s.,>+~-])(?:eyebrow|kicker|overline)\b/i.test(block.selector) && !UPPER_RE.test(block.body)) {
      const at = block.offset - 1;
      ctx.emit("tracked-caps", ctx.lineOf(at), ctx.colOf(at), "eyebrow class");
    }
    if (/font-style\s*:\s*italic|fontStyle\s*:\s*["'`]italic/.test(block.body)) {
      for (const sel of block.selector.split(",")) {
        const last = sel.trim().split(/[\s>+~]+/).pop() || "";
        for (const m of last.matchAll(/\.([\w-]+)/g)) ctx.italicClasses.add(m[1]);
      }
    }
  }
  for (const m of ctx.code.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    checkCaps(ctx, m[1] ?? m[2], m.index);
  }
  for (const m of ctx.code.matchAll(/\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`)/g)) {
    const cls = m[1] ?? m[2] ?? m[3];
    const tokens = cls.split(/\s+/);
    // a label named for what it is: the eyebrow over a heading, however it's styled
    if (tokens.some((t) => /^(?:eyebrow|kicker|overline|pretitle|supertitle)(?:$|[-_])/i.test(t))) ctx.emit("eyebrow-copy", ctx.lineOf(m.index), ctx.colOf(m.index), "eyebrow class");
    if (!tokens.includes("uppercase")) continue;
    const tracked = tokens.some((t) => /^tracking-(?:wide|wider|widest|\[(?!-)[\d.]+\w*\])$/.test(t));
    ctx.emit(tracked ? "tracked-caps" : "uppercase", ctx.lineOf(m.index), ctx.colOf(m.index));
  }
}

function detectHeadings(ctx) {
  const italicClassRe = ctx.italicClasses.size
    ? new RegExp(`class(?:Name)?\\s*=\\s*["'][^"']*\\b(?:${[...ctx.italicClasses].map((c) => c.replace(/[-]/g, "\\-")).join("|")})\\b`)
    : null;
  for (const m of ctx.code.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const inner = m[2];
    const innerOffset = m.index + m[0].indexOf(">") + 1;
    const re = /<(?:em|i)\b|font-style\s*:\s*italic|fontStyle\s*:\s*["'`]italic|class(?:Name)?\s*=\s*["'][^"']*\bitalic\b/i;
    let hit = re.exec(inner);
    if (!hit && italicClassRe) hit = italicClassRe.exec(inner);
    if (hit) {
      const at = innerOffset + hit.index;
      ctx.emit("italic-accent", ctx.lineOf(at), ctx.colOf(at), null, true);
    }
  }
}

function detectCodeLines(ctx) {
  ctx.codeLines.forEach((line, i) => {
    if (!line.trim()) return;
    let m;
    // glass
    if (!/@supports/.test(line) && (m = /(?:backdrop-filter|backdropFilter)\s*:(?!\s*["'`]?none\b)|\bbackdrop-blur(?:-[\w[\]]+)?\b/.exec(line))) {
      ctx.emit("glass", i, m.index);
    }
    // gradient text
    if ((m = /background-clip\s*:\s*text|[Bb]ackgroundClip\s*:\s*["'`]text|\bbg-clip-text\b/.exec(line))) ctx.emit("gradient-text", i, m.index);
    // big blur glows
    for (const b of line.matchAll(/blur\(\s*([\d.]+)(px|rem|em)\s*\)|\bblur-(2xl|3xl)\b|\bblur-\[(\d+)px\]/g)) {
      const px = b[3] ? (b[3] === "2xl" ? 40 : 64) : b[4] ? +b[4] : b[2] === "px" ? +b[1] : +b[1] * 16;
      if (px >= 40) {
        ctx.emit("glow-blur", i, b.index, `blur ${px}px`);
        break;
      }
    }
    // pills
    for (const r of line.matchAll(/(?:border(?:-[a-z-]+)?-radius|--[\w-]*radius[\w-]*|border\w*Radius)\s*:\s*([^;{}\n]+)/gi)) {
      // a JSX style object continues after the comma; CSS radii only have commas inside var()
      const v = /Radius/.test(r[0]) ? r[1].split(",")[0] : r[1];
      const big =
        /var\(--[\w-]*(?:pill|capsule|full)[\w-]*/i.test(v) ||
        [...v.matchAll(/(\d+(?:\.\d+)?)(px|rem|em|vh|vw|vmin|vmax|dvh|svh)?/g)].some(([, n, u]) => {
          const x = +n;
          if (!u) return /^\s*["'`]?\d/.test(v) && /Radius/.test(r[0]) && x >= 100; // TSX numeric px
          if (u === "px") return x >= 100;
          if (u === "rem" || u === "em") return x >= 6;
          return x >= 50;
        });
      if (big && !ctx.circleLines.has(i)) {
        ctx.emit("pill-radius", i, r.index);
        break;
      }
    }
    if ((m = /\brounded-full\b/.exec(line)) && !/avatar/i.test(line) && !isSquareClasses(line)) ctx.emit("pill-radius", i, m.index, "rounded-full");
    // ambient motion
    if (
      (m = /animation(?:-iteration-count)?\s*:[^;{}\n]*\binfinite\b|animation(?:IterationCount)?\s*:\s*["'`][^"'`]*\binfinite\b|\banimate-(?:pulse|ping|spin|bounce)\b|iterations\s*:\s*Infinity/.exec(line))
    ) {
      ctx.emit("ambient-motion", i, m.index);
    }
    // side-tab (thick left/inline-start border callout, >= 2px)
    if (
      (m = /(?:border-(?:left|inline-start)(?:-width)?|borderLeft(?:Width)?)\s*:\s*["'`]?(\d+(?:\.\d+)?)px\b/.exec(line)) &&
      +m[1] >= 2 &&
      !/\btransparent\b|\bnone\b/i.test(line.slice(m.index, m.index + 80))
    ) {
      ctx.emit("side-tab", i, m.index, `${m[1]}px left border`);
    } else if ((m = /\bborder-[ls]-(?:[248]|\[(\d+)px\])\b/.exec(line)) && (!m[1] || +m[1] >= 2)) {
      ctx.emit("side-tab", i, m.index, m[0]);
    } else if ((m = /box-shadow\s*:\s*inset\s+([2-9]|1\d)px\s+0(?:px)?\s+0(?:px)?\s+(?!transparent|rgba\(0,\s*0,\s*0,\s*0\))\S/i.exec(line))) {
      // the same stripe drawn with a shadow: box-shadow: inset 2px 0 0 var(--accent)
      ctx.emit("side-tab", i, m.index, `${m[1]}px inset shadow stripe`);
    }
    // bounce / overshoot easing
    for (const cb of line.matchAll(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/gi)) {
      const y1 = +cb[2];
      const y2 = +cb[4];
      if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) {
        ctx.emit("bounce-easing", i, cb.index, cb[0]);
        break;
      }
    }
    if ((m = /\bbounce\s*:\s*0*(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)\b/.exec(line))) {
      ctx.emit("bounce-easing", i, m.index, m[0]);
    }
    // transition: all / will-change: all
    if (
      (m = /\btransition(?:-property)?\s*:\s*["'`]?all\b|\btransition-all\b|\bwill-change\s*:\s*["'`]?all\b|\bwill-change-auto\b(?=$^)/.exec(line))
    ) {
      ctx.emit("transition-all", i, m.index, m[0]);
    }
    // track motion definitions for file-level reduced-motion-guard check
    if (
      !ctx.firstMotion &&
      (m = /@keyframes\b|\b(?:animation|animation-name)\s*:(?!\s*none\b)|<motion\./.exec(line))
    ) {
      ctx.firstMotion = { line: i, col: m.index };
    }
    // default fonts
    if (FONT_CONTEXT_RE.test(line)) {
      const found = [...line.matchAll(FONT_RE)];
      for (const f of found) ctx.fontUse(f[0].replace(/\+/g, " "), i, f.index);
    }
    // purple / indigo
    const p = findPurple(line);
    if (p >= 0) ctx.emit("purple-default", i, p);
    // gradients (aggregate)
    for (const g of line.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\(|\bbg-(?:gradient-to|linear|radial|conic)-\w+/g)) {
      ctx.aggregate("gradient-count", i, g.index);
    }
  });
}

const SPEC_ADJ_RE = /\b(?:high-voltage|surgical|razor-sharp|calibrated|stunning|premium|cutting-edge|world-class|seamless(?:ly)?|effortless(?:ly)?|pixel-perfect|next-gen(?:eration)?|blazing(?:ly)?[- ]fast)\b/i;
const STATUS_PHRASE_RE = /all systems (?:are )?operational|now in beta|commissions open|systems? nominal|\b\d{1,2}:\d{2}(?::\d{2})?\s+(?:to|until|till)\s+(?:close|closing|start|drop|go|launch|kick-?off|lock)\b/i;
const STATUS_BADGE_RE = /^[●•◉·○\s]*(?:LIVE|BETA|NEW|ALPHA|Live|Beta|Alpha)$/;
const CTA_RE = /^(?:Get started|Learn more|Explore|Read more|See more|Discover more|Browse)\b/i;
const PLACEHOLDER_COPY_RE = /\b(?:john\s+doe|jane\s+doe|lorem\s+ipsum|dolor\s+sit\s+amet|user\s+name|acme\s+(?:corp|inc|co))\b|@username\b/i;
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[✦✧✶✷✸✹✺❇❈⁂]/u;

/** Joins segments that a bare or dangling dot ties together ("A" "·" "B"). */
function dotGroups(segments) {
  const groups = [];
  const isDot = (s) => /^[·•]$/.test(s);
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const prev = segments[k - 1];
    const join = groups.length && (isDot(seg) || isDot(prev) || /[·•]$/.test(prev) || /^[·•]/.test(seg));
    if (join) groups[groups.length - 1] += " " + seg;
    else groups.push(seg);
  }
  return groups;
}

function detectVisible(ctx) {
  ctx.visible.forEach((segments, i) => {
    if (!segments.length) return;
    const text = segments.join(" ");
    const emit = (rule, idx, msg) => ctx.emit(rule, i, idx, msg, true);
    let m;
    if ((m = EMOJI_RE.exec(text))) emit("emoji-sparkle", m.index);
    {
      const keys = shortcutsIn(text);
      const declared = ctx.config?.shortcuts;
      const open = declared?.size ? keys.filter((k) => !declared.has(k.key)) : keys;
      if (open.length) emit("fake-shortcut", open[0].index);
      else if (keys.length) ctx.emit("fake-shortcut", i, keys[0].index, null, true, `.tellsrc declares ${keys.map((k) => k.raw).join(", ")}`);
    }
    for (const d of text.matchAll(/—/g)) ctx.aggregate("em-dash", i, d.index, true);
    if ((m = /DESIGN SYSTEM|\bDesign System\s+\d|\bsystem\s+\d{2}\b/i.exec(text)) && /DESIGN SYSTEM|\d/.test(m[0])) emit("eyebrow-copy", m.index);
    else if ((m = /\bclick (?:any|to copy)\b|\bauthored by\b|\bauthor model\b/i.exec(text))) emit("meta-copy", m.index);
    for (const group of dotGroups(segments)) {
      const dots = [...group.matchAll(/(?:^|\s)[·•](?=\s|$)/g)];
      const parts = group.split(/(?:^|\s)[·•](?=\s|$)/).filter((s) => s.trim()).length;
      const at = Math.max(0, text.indexOf(group.split(" ")[0])) ;
      if (dots.length >= 2 && parts >= 3) emit("dot-triplet", at);
      else if (dots.length >= 1 && parts >= 2) emit("dot-separator", at);
    }
    if ((m = /FIG\.?\s*\d|\d+°\s*\d+(?:\.\d+)?\s*[′']|\[[A-Z]{2,}[._:-][A-Z0-9._:-]+\]|\b\d{2}\.\d{2,}%|\b[A-Z]{3}\s+\d{2}:\d{2}:\d{2}\b/i.exec(text))) {
      emit("decorative-data", m.index);
    }
    if ((m = STATUS_PHRASE_RE.exec(text))) emit("status-theatre", m.index);
    if ((m = SPEC_ADJ_RE.exec(text))) emit("spec-adjective", m.index);
    if ((m = PLACEHOLDER_COPY_RE.exec(text))) emit("placeholder-copy", m.index);
    for (const seg of segments) {
      const at = Math.max(0, text.indexOf(seg));
      // a lone arrow is a key or an icon (<kbd>→</kbd>), not a suffix
      if (/\S\s*[→⟶➔➜➝➞↗»›]\s*$|^[→⟶➔➜]\s+\D/.test(seg) && !/\d\s*→\s*\d/.test(seg)) emit("arrow-suffix", at);
      if (/^(?:§\s*)?\d{2}\s*(?:\/|\||—|–)\s+\S|^§\s*\d|^\d{2}\.\s+\p{Lu}/u.test(seg)) emit("numbered-section", at);
      if (/^[—–]\s*\p{Lu}{3,}|^[●•·]\s*\p{Lu}{2,}/u.test(seg)) emit("eyebrow-copy", at);
      if (STATUS_BADGE_RE.test(seg)) emit("status-theatre", at);
      if (CTA_RE.test(seg) && seg.split(/\s+/).length <= 6) emit("generic-cta", at);
    }
  });
}

// ---------------------------------------------------------------------------
// Suppressions

function parseSuppressions(rawLines) {
  const byLine = new Map();
  rawLines.forEach((line, i) => {
    for (const m of line.matchAll(/(?:tells|slop)-ok:\s*([\w-]*)([^\n]*?)(?=(?:tells|slop)-ok:|\*\/|-->|$)/g)) {
      const rule = m[1];
      const reason = m[2].replace(/^[\s:—–-]+/, "").replace(/\}\s*$/, "").trim();
      const list = byLine.get(i) || [];
      list.push({ rule, reason, line: i, used: false });
      byLine.set(i, list);
    }
  });
  return byLine;
}

// ---------------------------------------------------------------------------
// Per-file audit

function snippetFrom(line, col, width = 96) {
  const clean = line.replace(/\t/g, " ");
  if (clean.trim().length <= width) return clean.trim();
  const start = Math.max(0, Math.min(col - 24, clean.length - width));
  const lead = clean.slice(0, start).trim() ? "…" : "";
  const body = clean.slice(start, start + width).trim();
  const tail = start + width < clean.length ? "…" : "";
  return lead + body + tail;
}

function auditFile(file, onlyRule, source = null) {
  const raw = source ?? fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  const rel = display(file);
  const rawLines = raw.split("\n");

  let code;
  let visible;
  if (ext === ".html") {
    const split = splitHtml(raw);
    code = split.code;
    visible = visibleFromHtml(split.vis);
  } else if (ext === ".css") {
    code = stripBlockComments(raw);
    visible = rawLines.map(() => []);
  } else if (ext === ".mdx") {
    code = stripBlockComments(raw);
    visible = visibleFromMdx(raw);
  } else {
    code = stripLineComments(stripBlockComments(raw));
    visible = visibleFromJsx(code.split("\n"));
    if (SCRIPT_EXTENSIONS.has(ext)) {
      const strings = visibleFromScriptStrings(code.split("\n"));
      visible = visible.map((segs, i) => [...new Set([...segs.filter((s) => !/['"`]/.test(s)), ...strings[i]])]);
    }
  }
  const rc = configFor(file);
  const config = rc?.config ?? null;
  const codeLines = code.split("\n");
  const lineStarts = [0];
  for (let k = 0; k < code.length; k++) if (code[k] === "\n") lineStarts.push(k + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const colOf = (offset) => offset - lineStarts[lineOf(offset)];

  const candidates = new Map(); // `${rule}:${line}` -> candidate
  const aggregates = new Map(); // rule -> [{line, col, visible, count}]
  const fontUses = new Map(); // font -> [{line, col}]
  const ctx = {
    ext,
    code,
    codeLines,
    visible,
    lineOf,
    colOf,
    italicClasses: new Set(),
    circleLines: new Set(),
    firstMotion: null,
    config,
    emit(rule, line, col, message = null, fromVisible = false, declared = null) {
      if (onlyRule && rule !== onlyRule) return;
      const key = `${rule}:${line}`;
      if (candidates.has(key)) return;
      candidates.set(key, { rule, line, col, message, fromVisible, declared });
    },
    fontUse(font, line, col) {
      if (onlyRule && onlyRule !== "default-font") return;
      const list = fontUses.get(font) || [];
      if (!list.some((u) => u.line === line)) list.push({ line, col });
      fontUses.set(font, list);
    },
    aggregate(rule, line, col, fromVisible = false) {
      if (onlyRule && rule !== onlyRule) return;
      const list = aggregates.get(rule) || [];
      const existing = list.find((a) => a.line === line);
      if (existing) existing.count++;
      else list.push({ rule, line, col, fromVisible, count: 1 });
      aggregates.set(rule, list);
    },
  };

  detectBlocks(ctx);
  detectHeadings(ctx);
  detectCodeLines(ctx);
  detectVisible(ctx);

  if (
    ctx.firstMotion &&
    !/prefers-reduced-motion|\bmotion-(?:safe|reduce):|MotionConfig|useReducedMotion/.test(ctx.code)
  ) {
    ctx.emit("reduced-motion-guard", ctx.firstMotion.line, ctx.firstMotion.col, "motion without prefers-reduced-motion");
  }

  const suppressions = parseSuppressions(rawLines);
  const findSuppression = (rule, line) => {
    for (const l of [line, line - 1]) {
      const s = (suppressions.get(l) || []).find((x) => x.rule === rule && x.reason);
      if (s) return s;
    }
    return null;
  };

  const hits = [];
  const allowed = [];
  const makeSnippet = (c) => {
    const src = c.fromVisible ? visible[c.line].join(" ") : rawLines[c.line] ?? "";
    const snip = snippetFrom(src, c.col);
    return c.message ? `(${c.message}) ${snip}` : snip;
  };
  const push = (c) => {
    const rule = RULE_BY_ID.get(c.rule);
    const s = findSuppression(c.rule, c.line);
    const base = { file: rel, line: c.line + 1, rule: c.rule, severity: rule.severity, category: rule.category, snippet: makeSnippet(c) };
    if (c.declared) {
      allowed.push({ ...base, reason: c.declared });
    } else if (s) {
      s.used = true;
      allowed.push({ ...base, reason: s.reason });
    } else {
      hits.push({ ...base, fix: rule.fix });
    }
  };

  for (const c of candidates.values()) push(c);

  for (const [rule, list] of aggregates) {
    const open = [];
    for (const a of list) {
      const s = findSuppression(rule, a.line);
      if (s) {
        s.used = true;
        allowed.push({
          file: rel, line: a.line + 1, rule, severity: RULE_BY_ID.get(rule).severity, category: RULE_BY_ID.get(rule).category,
          snippet: snippetFrom(a.fromVisible ? visible[a.line].join(" ") : rawLines[a.line], a.col), reason: s.reason,
        });
      } else open.push(a);
    }
    const total = open.reduce((n, a) => n + a.count, 0);
    if (rule === "gradient-count" && total > GRADIENT_LIMIT) {
      push({ rule, line: open[0].line, col: open[0].col, message: `${total} gradients, limit ${GRADIENT_LIMIT}`, fromVisible: false });
    }
    if (rule === "em-dash" && total > EM_DASH_LIMIT) {
      for (const a of open) hits.push({
        file: rel, line: a.line + 1, rule, severity: "warn", category: "copy",
        snippet: `(${total} in file) ${snippetFrom(visible[a.line].join(" "), a.col)}`, fix: RULE_BY_ID.get(rule).fix,
      });
    }
  }

  // one default-font hit per face per file; a tells-ok on any use covers the face
  for (const [font, uses] of fontUses) {
    const covered = uses.find((u) => findSuppression("default-font", u.line));
    const at = covered || uses[0];
    const extra = uses.length > 1 ? `, ${uses.length} lines` : "";
    push({ rule: "default-font", line: at.line, col: at.col, message: `${font}${extra}`, fromVisible: false });
  }

  // malformed suppressions
  for (const list of suppressions.values()) {
    for (const s of list) {
      const meta = (id, message) => {
        if (onlyRule && onlyRule !== id) return;
        const r = RULE_BY_ID.get(id);
        hits.push({ file: rel, line: s.line + 1, rule: id, severity: r.severity, category: r.category, snippet: `(${message}) ${snippetFrom(rawLines[s.line], rawLines[s.line].search(/(?:tells|slop)-ok/))}`, fix: r.fix });
      };
      if (!s.rule || (!RULE_BY_ID.has(s.rule) && !OTHER_TOOL_RULES.has(s.rule))) meta("ok-unknown", `unknown rule "${s.rule}"`);
      else if (!s.reason) meta("ok-reason", `no reason for ${s.rule}`);
    }
  }

  // .tellsrc "allow": a project-wide exception, still listed as allowed so it stays visible and counted
  if (config) {
    for (let k = hits.length - 1; k >= 0; k--) {
      const reason = config.allow[hits[k].rule];
      if (!reason) continue;
      const { fix, ...h } = hits[k];
      allowed.push({ ...h, reason: `.tellsrc: ${reason}` });
      hits.splice(k, 1);
    }
  }

  hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  allowed.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return { hits, allowed, rc };
}

/** Problems in a .tellsrc itself: bad JSON, an unknown rule, an allow with no reason. Reported once per file. */
function configHits(rc, onlyRule) {
  const out = [];
  const meta = (id, message) => {
    if (onlyRule && onlyRule !== id) return;
    const r = RULE_BY_ID.get(id);
    out.push({ file: display(rc.file), line: 1, rule: id, severity: r.severity, category: r.category, snippet: `(${message})`, fix: r.fix });
  };
  if (rc.error) meta("ok-unknown", `.tellsrc ${rc.error}`);
  for (const [rule, reason] of Object.entries(rc.config.allow)) {
    if (!RULE_BY_ID.has(rule) && !OTHER_TOOL_RULES.has(rule)) meta("ok-unknown", `.tellsrc allows unknown rule "${rule}"`);
    else if (!reason) meta("ok-reason", `.tellsrc allows ${rule} with no reason`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: wrap("31"), yellow: wrap("33"), green: wrap("32"), dim: wrap("2"), bold: wrap("1"), cyan: wrap("36") };
}

function printReport({ files, hits, allowed }, paint) {
  const out = [];
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  const idWidth = Math.max(...RULES.map((r) => r.id.length));

  for (const [file, list] of byFile) {
    const errors = list.filter((h) => h.severity === "error").length;
    out.push(paint.bold(file) + paint.dim(`  ${errors} error, ${list.length - errors} warn`));
    const locWidth = Math.max(...list.map((h) => `${h.file}:${h.line}`.length));
    for (const h of list) {
      const loc = `${h.file}:${h.line}`.padEnd(locWidth);
      const sev = h.severity === "error" ? paint.red("[error]") : paint.yellow("[warn] ");
      out.push(`  ${paint.dim(loc)}  ${sev} ${h.rule.padEnd(idWidth)}  ${h.snippet}`);
    }
    out.push("");
  }

  if (allowed.length) {
    out.push(paint.bold("Allowed") + paint.dim(`  ${allowed.length} justified exception${allowed.length === 1 ? "" : "s"}`));
    const locWidth = Math.max(...allowed.map((a) => `${a.file}:${a.line}`.length));
    for (const a of allowed) {
      out.push(`  ${paint.dim(`${a.file}:${a.line}`.padEnd(locWidth))}  ${paint.green("[ok]   ")} ${a.rule.padEnd(idWidth)}  ${a.reason}`);
    }
    out.push("");
  }

  const hitRules = [...new Set(hits.map((h) => h.rule))].sort();
  if (hitRules.length) {
    out.push(paint.bold("Fixes"));
    for (const id of hitRules) out.push(`  ${paint.cyan(id.padEnd(idWidth))}  ${RULE_BY_ID.get(id).fix}`);
    out.push("");
  }

  out.push(paint.bold("Summary") + paint.dim(`  ${files.length} file${files.length === 1 ? "" : "s"} scanned`));
  out.push(`  ${"category".padEnd(12)}${"error".padStart(7)}${"warn".padStart(7)}${"allowed".padStart(9)}`);
  const row = (name, e, w, a) => `  ${name.padEnd(12)}${String(e).padStart(7)}${String(w).padStart(7)}${String(a).padStart(9)}`;
  let te = 0;
  let tw = 0;
  let ta = 0;
  for (const cat of CATEGORIES) {
    const e = hits.filter((h) => h.category === cat && h.severity === "error").length;
    const w = hits.filter((h) => h.category === cat && h.severity === "warn").length;
    const a = allowed.filter((h) => h.category === cat).length;
    te += e;
    tw += w;
    ta += a;
    if (cat === "meta" && !e && !w && !a) continue;
    const line = row(cat, e, w, a);
    out.push(e || w || a ? line : paint.dim(line));
  }
  out.push(`  ${"-".repeat(35)}`);
  out.push(paint.bold(row("total", te, tw, ta)));
  if (!hits.length) out.push(paint.green("\n  Clean."));
  console.log(out.join("\n"));
}

function summarize(hits, allowed) {
  const byCategory = {};
  for (const cat of CATEGORIES) {
    byCategory[cat] = {
      error: hits.filter((h) => h.category === cat && h.severity === "error").length,
      warn: hits.filter((h) => h.category === cat && h.severity === "warn").length,
      allowed: allowed.filter((h) => h.category === cat).length,
    };
  }
  const byRule = {};
  for (const h of hits) byRule[h.rule] = (byRule[h.rule] || 0) + 1;
  return {
    byCategory,
    byRule,
    errors: hits.filter((h) => h.severity === "error").length,
    warnings: hits.filter((h) => h.severity === "warn").length,
    allowed: allowed.length,
    total: hits.length,
  };
}

// ---------------------------------------------------------------------------

/** Checking nothing isn't a pass: a wrong path in CI would go green forever. */
export const noSource = (targets) =>
  `no UI source in ${targets.map(display).join(", ")}. It reads .html, .css, .jsx, .tsx and .mdx, and .js, .mjs or .ts files that build HTML (node_modules, dist and build are skipped). For a built or live page, use tells render.`;

export function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);

  if (flags.rules) {
    for (const r of RULES) console.log(`${r.id.padEnd(18)} ${r.severity.padEnd(6)} ${r.category.padEnd(11)} ${r.fix}`);
    return;
  }

  const onlyRule = typeof flags.rule === "string" ? flags.rule : null;
  if (flags.rule && (!onlyRule || !RULE_BY_ID.has(onlyRule))) {
    throw new Error(`unknown rule "${onlyRule ?? ""}". Known: ${RULES.map((r) => r.id).join(", ")}`);
  }

  const targets = (positional.length ? positional : DEFAULT_PATHS).map((p) => path.resolve(ROOT, p));
  const files = [];
  for (const t of targets) walk(t, files);
  if (!files.length) throw new Error(noSource(targets));

  const hits = [];
  const allowed = [];
  const configs = new Set();
  for (const file of files) {
    const result = auditFile(file, onlyRule);
    hits.push(...result.hits);
    allowed.push(...result.allowed);
    if (result.rc && !configs.has(result.rc.file)) {
      configs.add(result.rc.file);
      hits.push(...configHits(result.rc, onlyRule));
    }
  }

  if (flags.json) {
    const payload = {
      paths: targets.map(display),
      rule: onlyRule,
      files: files.map(display),
      hits,
      allowed,
      summary: summarize(hits, allowed),
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    printReport({ files, hits, allowed }, makePaint(color));
  }

  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}

export { RULES, RULE_BY_ID, OTHER_TOOL_RULES, auditFile, configHits, walk, display, printReport, makePaint, summarize, parseArgs };
