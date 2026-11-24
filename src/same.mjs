/**
 * tells same: catch a design that lands on a default look or on your own last one.
 *
 * Usage:
 *   tells same [designs...] [--against <path>]... [--house <path>] [--no-siblings] [--json]
 *
 * A design is a folder (its tokens.css, or the CSS/HTML file declaring the most :root tokens)
 * or a single CSS/HTML file. A folder that holds several designs checks each one against the rest.
 *
 * Three checks, all from tokens and CSS, no browser:
 *   1. The cliché clusters in rules/anti-slop.md §3 (warm paper, acid dark, neo-Swiss, glow void, soft commerce).
 *   2. Your house style: the look most of a design's siblings share, found per axis
 *      (page, ink, hairline, accent, typeface, radius). Siblings are the other designs beside it
 *      plus anything passed with --against.
 *   3. Token copies: 6+ colour tokens with a sibling's name and value (within 6/255).
 *
 * Allow one with `tells-ok: <rule-id> <reason>` in the design's tokens, DESIGN.md or directions.md.
 * `house-style-ok: <reason>` is accepted for house-style. Exit 1 on any open error.
 */
import fs from "node:fs";
import path from "node:path";
import { display, makePaint, parseArgs } from "./check.mjs";

const ROOT = process.cwd();
const COPY_LIMIT = 6;
const HOUSE_FAIL = 5;
const MIN_HISTORY = 3;
const INTERNAL = /^(screens?|landing|comps?|app|pages?|components?|round-?\d+|v\d+|assets?|styles?|css|src|public|dist|mobile|desktop|moodboard|specimens?)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "shots", "coverage"]);

export const RULES = [
  { id: "cluster-warm-paper", severity: "error", fix: "Cream paper, a book serif and a terracotta accent is cluster 1. Derive surface, type and accent from the subject, or name the printed source that earns them." },
  { id: "cluster-acid-dark", severity: "error", fix: "Near-black, hairlines and one acid accent is cluster 2. Ask what this subject's own surfaces and signals look like." },
  { id: "cluster-neo-swiss", severity: "error", fix: "Zero radius, hairline rules, condensed grotesk and red with blue is cluster 3. Keep the grid only if the subject's own documents use it." },
  { id: "cluster-glow-void", severity: "error", fix: "A dark void with glass, glow and violet or coral washes is cluster 4. Remove the effects and start from the subject's real materials." },
  { id: "cluster-soft-commerce", severity: "error", fix: "Putty, forest green or brass, pills and italic serif notes is cluster 5. Derive the palette from the products themselves." },
  { id: "house-style", severity: "error", fix: "This matches your house style: the look most of your other designs share, or the design named with --house. Derive it from this subject, or write why this subject earns it." },
  { id: "token-copy", severity: "error", fix: "Six or more colour tokens copied from a sibling. Every colour needs an origin in this subject." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Colour

function parseColor(v) {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("") + (h.length === 4 ? h[3] + h[3] : "");
    if (h.length === 8 && parseInt(h.slice(6), 16) < 230) return null; // translucent: not a surface
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return a < 0.9 ? null : [m[1], m[2], m[3]].map(Number);
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return a < 0.9 ? null : hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  }
  return null;
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

function hsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Hues within 24° of a neighbour are one family; returns one representative hue per family. */
function hueGroups(hues) {
  const sorted = [...hues].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const groups = [[sorted[0]]];
  for (const h of sorted.slice(1)) {
    const last = groups[groups.length - 1];
    if (h - last[last.length - 1] <= 24) last.push(h);
    else groups.push([h]);
  }
  if (groups.length > 1 && sorted[0] + 360 - sorted[sorted.length - 1] <= 24) groups[0].push(...groups.pop()); // wrap past red
  return groups.map((g) => g[0]);
}

const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
const HUES = [[15, "red"], [40, "orange"], [65, "yellow"], [165, "green"], [200, "cyan"], [250, "blue"], [290, "violet"], [345, "magenta"], [360, "red"]];
const hueName = (h) => HUES.find(([max]) => h < max)[1];

// ---------------------------------------------------------------------------
// Type

const SERIF = /serif(?!.*sans)|georgia|times|garamond|caslon|baskerville|playfair|fraunces|newsreader|lora|merriweather|cormorant|spectral|crimson|tiempos|sectra|canela|freight|literata|bodoni|didot|new york|young serif|instrument serif|dm serif|charter|iowan|minion|sabon|plantin|lyon|domaine|recoleta/i;
const MONO = /mono|code|courier|menlo|consolas|iosevka|monaco/i;
const CONDENSED = /condensed|narrow|compressed|oswald|bebas|anton|league gothic|antonio|barlow condensed|archivo narrow|six caps/i;

// The faces a generator reaches for when nothing about the subject picked one.
const NEUTRAL_GROTESK = /^(inter|inter tight|inter display|geist|instrument sans|public sans|helvetica|helvetica neue|arial|system-ui|-apple-system|blinkmacsystemfont|sf pro|sf pro text|sf pro display|roboto|ibm plex sans|dm sans|manrope|plus jakarta sans|segoe ui|sans-serif|switzer|satoshi|general sans|söhne|sohne|suisse int'l|neue haas grotesk|aktiv grotesk|untitled sans)$/i;

function typeClass(family) {
  if (!family) return null;
  if (NEUTRAL_GROTESK.test(family.trim())) return "neutral grotesk";
  if (MONO.test(family)) return "mono";
  if (CONDENSED.test(family)) return "condensed";
  if (SERIF.test(family)) return "serif";
  return "other sans";
}

function familyOf(decl) {
  if (!decl) return null;
  const quoted = /["']([^"']+)["']/.exec(decl);
  if (quoted) return quoted[1];
  const first = decl.split(",")[0].trim();
  return /^var\(/.test(first) ? null : first.split(/\s+/).slice(-2).join(" ").replace(/^\d[\w/.]*\s+/, "");
}

// ---------------------------------------------------------------------------
// Reading a design

/** Custom properties: :root blocks first, then the first theme scope that sets each one. */
function rootProps(text) {
  const props = {};
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const ordered = [...blocks.filter((b) => /:root\s*$/.test(b.sel)), ...blocks.filter((b) => !/:root\s*$/.test(b.sel))];
  for (const b of ordered) for (const p of b.body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);?/gi)) props[p[1].toLowerCase()] ??= p[2].trim();
  return props;
}

const resolve = (props, v, depth = 0) => {
  const m = /^var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v?.trim() ?? "");
  if (!m || depth > 4) return v;
  return resolve(props, props[m[1].toLowerCase()] ?? m[2], depth + 1);
};

function filesIn(dir, depth = 0, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 2 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) filesIn(p, depth + 1, out);
    } else if (/\.(css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The file that carries a design's tokens, and all of its CSS/HTML for effects and fonts. */
function source(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return { dir: path.dirname(target), name: path.basename(target).replace(/\.\w+$/, ""), tokens: target, files: [target] };
  const files = filesIn(target).slice(0, 40);
  const tokensCss = path.join(target, "tokens.css");
  let best = fs.existsSync(tokensCss) ? tokensCss : null;
  if (!best) {
    let n = 0;
    for (const f of files) {
      const k = Object.keys(rootProps(fs.readFileSync(f, "utf8"))).length;
      if (k > n) [best, n] = [f, k];
    }
  }
  return best ? { dir: target, name: path.basename(target), tokens: best, files } : null;
}

function pickToken(props, re) {
  const key = Object.keys(props).find((k) => re.test(k));
  if (!key) return null;
  const value = resolve(props, props[key]);
  return { key, value, rgb: parseColor(value) };
}

const STATUS_NAME = /(^|-)(ok|warn|warning|err|error|danger|success|up|down|loss|gain|pos|neg|info|alert|bad|good|crit|critical|high|med|low|positive|negative)(-|$)/;

function features(src) {
  const tokenText = fs.readFileSync(src.tokens, "utf8");
  const all = src.files.map((f) => fs.readFileSync(f, "utf8").slice(0, 400_000)).join("\n");
  const props = rootProps(tokenText);
  const BODY = /(?:^|[\s},])body\s*\{([^}]*)\}/;
  const bodyRule = BODY.exec(tokenText)?.[1] ?? BODY.exec(all)?.[1] ?? "";
  const fromBody = (prop) => {
    const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(bodyRule);
    const value = m && resolve(props, m[1].trim());
    return value ? { key: `body ${prop}`, value, rgb: parseColor(value) } : null;
  };

  const page = pickToken(props, /^(color-)?(bg|page|paper|canvas|background|surface|base)(-0|-1|-base|-page|-default)?$/) ?? fromBody("background(?:-color)?");
  const ink = pickToken(props, /^(color-)?(ink|text|fg|foreground|body)(-1|-primary|-default)?$/) ?? fromBody("color");
  const line = pickToken(props, /^(color-)?(line|border|rule|hairline|divider|stroke)(-1|-subtle|-default)?$/);

  const accents = [];
  for (const [k, raw] of Object.entries(props)) {
    if (STATUS_NAME.test(k) || /shadow|overlay|scrim/.test(k)) continue;
    const rgb = parseColor(resolve(props, raw));
    if (!rgb) continue;
    const c = hsl(rgb);
    if (c.s >= 0.5 && c.l >= 0.25 && c.l <= 0.7) accents.push({ key: k, ...c, name: hueName(c.h) });
  }
  const accentHues = hueGroups(accents.map((a) => a.h));

  const fontTokens = Object.entries(props).filter(([k]) => /font|family|serif|sans|mono|display|heading|^ff?-|typeface/.test(k) && !/size|weight|feature|leading|track|^t-|^f-tight/.test(k));
  const fam = (re) => familyOf(resolve(props, fontTokens.find(([k]) => re.test(k))?.[1]));
  const shorthand = /(?:^|[;\s])font\s*:\s*(?:[\w-]+\s+)*?[\d.]+(?:px|rem|em|%)(?:\s*\/\s*[\d.]+\w*)?\s+([^;}]+)/.exec(bodyRule)?.[1];
  const body = fam(/body|sans|ui|text|^font$|^font-family$|base/) ?? familyOf(resolve(props, /font-family\s*:\s*([^;}]+)/.exec(bodyRule)?.[1])) ?? familyOf(resolve(props, shorthand)) ?? familyOf(/font-family\s*:\s*([^;}]+)/.exec(all)?.[1]);
  const displayFam = fam(/display|heading|head|title|serif/) ?? body;

  const radii = Object.entries(props)
    .filter(([k]) => /(^r-|radius|rounded)/.test(k))
    .map(([, v]) => /^([\d.]+)(px|rem)/.exec(resolve(props, v)))
    .filter(Boolean)
    .map(([, n, u]) => (u === "rem" ? +n * 16 : +n));
  const cssRadii = [...all.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem)/g)].map(([, n, u]) => (u === "rem" ? +n * 16 : +n));
  const pill = [...radii, ...cssRadii].some((r) => r >= 100) || /\brounded-full\b|border-radius\s*:\s*(?:999|9999)/.test(all);
  const nonPill = (radii.length ? radii : cssRadii).filter((r) => r < 100);
  const radius = nonPill.length ? Math.max(...nonPill) : null;

  return {
    name: src.name,
    file: display(src.tokens),
    props,
    page, ink, line, accents, accentHues, body, displayFam,
    bodyClass: typeClass(body),
    displayClass: typeClass(displayFam),
    radius,
    pill,
    glass: /backdrop-filter\s*:(?!\s*none)|\bbackdrop-blur\b/.test(all),
    glow: /blur\(\s*(?:[4-9]\d|\d{3,})px\s*\)|\bblur-(?:2xl|3xl)\b/.test(all),
    italic: /font-style\s*:\s*italic|<em\b|\bitalic\b/.test(all),
    text: all,
  };
}

// ---------------------------------------------------------------------------
// Axes: one bucket per axis, so two designs can be compared and a majority found

function pageBucket(c) {
  if (!c?.rgb) return null;
  const { h, s, l } = hsl(c.rgb);
  const tone = l < 0.2 ? "dark" : l > 0.85 ? "light" : "mid";
  const temp = spread(c.rgb) <= 10 || s < 0.08 ? "neutral" : h >= 20 && h <= 70 ? "warm" : h >= 180 && h <= 260 ? "cool" : hueName(h);
  return `${tone} ${temp}`;
}
function inkBucket(c) {
  if (!c?.rgb) return null;
  const { l } = hsl(c.rgb);
  const tinted = spread(c.rgb) > 22;
  return l <= 0.15 ? (tinted ? "dark tinted" : "near-black") : l >= 0.88 ? "near-white" : tinted ? "tinted" : "grey";
}
function lineBucket(c) {
  if (!c?.rgb) return null;
  const { l } = hsl(c.rgb);
  const tinted = spread(c.rgb) > 16;
  return l >= 0.84 && l <= 0.95 ? (tinted ? "light tinted" : "light grey") : l < 0.3 ? "dark" : tinted ? "tinted" : "mid grey";
}
function accentBucket(f) {
  if (!f.accents.length) return "none";
  return f.accentHues.length > 1 ? "several" : "one";
}
function radiusBucket(r) {
  if (r === null) return null;
  return r <= 2 ? "square" : r < 10 ? "small" : r <= 24 ? "card" : "large";
}

const AXES = {
  page: (f) => pageBucket(f.page),
  ink: (f) => inkBucket(f.ink),
  hairline: (f) => lineBucket(f.line),
  accent: (f) => accentBucket(f),
  typeface: (f) => f.bodyClass,
  radius: (f) => radiusBucket(f.radius),
};
const axesOf = (f) => Object.fromEntries(Object.entries(AXES).map(([k, fn]) => [k, fn(f)]));

// ---------------------------------------------------------------------------
// Clusters (rules/anti-slop.md §3). Each lists its tests; `key` must match for the cluster to count.

const light = (c) => c?.rgb && hsl(c.rgb).l >= 0.86;
const dark = (c) => c?.rgb && hsl(c.rgb).l <= 0.1;
const warmPaper = (c) => {
  if (!light(c)) return false;
  const { h, s } = hsl(c.rgb);
  return h >= 25 && h <= 65 && s >= 0.12 && spread(c.rgb) >= 6;
};
const hasAccent = (f, test) => f.accents.some(test);

const CLUSTERS = [
  {
    id: "cluster-warm-paper",
    key: "cream page",
    tests: {
      "cream page": (f) => warmPaper(f.page),
      "serif headings": (f) => f.displayClass === "serif",
      "terracotta or vermilion accent": (f) => hasAccent(f, (a) => a.h <= 32 || a.h >= 350),
      "dark ink": (f) => f.ink?.rgb && hsl(f.ink.rgb).l <= 0.2,
    },
  },
  {
    id: "cluster-acid-dark",
    key: "near-black page",
    tests: {
      "near-black page": (f) => dark(f.page),
      "one accent": (f) => f.accentHues.length === 1,
      "acid accent": (f) => hasAccent(f, (a) => a.s >= 0.7 && ((a.h >= 70 && a.h <= 200) || a.h <= 20)),
      "hairline borders": (f) => f.line?.rgb && hsl(f.line.rgb).l <= 0.3,
    },
  },
  {
    id: "cluster-neo-swiss",
    key: "zero radius",
    tests: {
      "zero radius": (f) => f.radius !== null && f.radius <= 2 && !f.pill,
      "condensed grotesk": (f) => f.displayClass === "condensed",
      "red and blue": (f) => hasAccent(f, (a) => a.name === "red") && hasAccent(f, (a) => a.name === "blue"),
      "hairline rules": (f) => Boolean(f.line?.rgb),
    },
  },
  {
    id: "cluster-glow-void",
    key: "dark page",
    tests: {
      "dark page": (f) => f.page?.rgb && hsl(f.page.rgb).l <= 0.16,
      glass: (f) => f.glass,
      glow: (f) => f.glow,
      "violet or coral wash": (f) => hasAccent(f, (a) => a.name === "violet" || a.name === "magenta" || (a.h <= 20 && a.l >= 0.55)),
    },
  },
  {
    id: "cluster-soft-commerce",
    key: "putty page",
    tests: {
      "putty page": (f) => warmPaper(f.page) && hsl(f.page.rgb).s <= 0.45,
      "forest green or brass": (f) => hasAccent(f, (a) => (a.h >= 110 && a.h <= 175 && a.l <= 0.45) || (a.h >= 38 && a.h <= 55 && a.s <= 0.75)),
      "pill buttons": (f) => f.pill,
      "italic serif": (f) => f.italic && (f.displayClass === "serif" || f.bodyClass === "serif"),
    },
  },
];

function clusterHits(f) {
  return CLUSTERS.map((c) => {
    const matched = Object.entries(c.tests).filter(([, t]) => t(f)).map(([name]) => name);
    return { id: c.id, matched, total: Object.keys(c.tests).length, hit: matched.includes(c.key) && matched.length >= 3 };
  });
}

// ---------------------------------------------------------------------------
// House style: per axis, the bucket most of the history shares

function houseOf(history) {
  if (history.length < MIN_HISTORY) return null;
  const house = {};
  for (const axis of Object.keys(AXES)) {
    const counts = new Map();
    for (const h of history) {
      const b = h.axes[axis];
      if (b) counts.set(b, (counts.get(b) || 0) + 1);
    }
    const known = [...counts.values()].reduce((a, b) => a + b, 0);
    const [bucket, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (bucket && known >= MIN_HISTORY && n >= Math.max(2, Math.ceil(known / 2))) house[axis] = { bucket, share: `${n}/${known}` };
  }
  return Object.keys(house).length >= 4 ? house : null;
}

function copiesOf(f, siblings) {
  return siblings
    .map((s) => {
      const shared = Object.entries(f.props).filter(([k, v]) => {
        const a = parseColor(resolve(f.props, v));
        const b = s.props[k] && parseColor(resolve(s.props, s.props[k]));
        return a && b && a.every((ch, i) => Math.abs(ch - b[i]) <= 6);
      });
      return { sibling: s.name, shared: shared.map(([k, v]) => `--${k}: ${v}`) };
    })
    .filter((c) => c.shared.length >= COPY_LIMIT)
    .sort((a, b) => b.shared.length - a.shared.length);
}

function exceptions(src) {
  const files = new Set([src.tokens, ...["tokens.css", "DESIGN.md", "directions.md"].map((n) => path.join(src.dir, n))]);
  const out = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:tells|slop)-ok:\s*([\w-]+)\s+([^\n]*?)\s*(?:\*\/|-->|$)/gm)) {
      if (RULE_BY_ID.has(m[1]) && m[2].trim()) out.set(m[1], { file: display(file), reason: m[2].trim() });
    }
    const h = /house-style-ok:\s*([^\n]*?)\s*(?:\*\/|-->|$)/m.exec(text);
    if (h?.[1].trim() && !out.has("house-style")) out.set("house-style", { file: display(file), reason: h[1].trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which designs, and whose history

function designsAt(target) {
  const abs = path.resolve(ROOT, target);
  if (!fs.existsSync(abs)) {
    process.stderr.write(`tells same: skipping missing path ${target}\n`);
    return [];
  }
  if (fs.statSync(abs).isFile()) return [abs];
  // A folder of designs: each subfolder with its own tokens is one.
  const subs = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_") && !SKIP_DIRS.has(e.name))
    .map((e) => path.join(abs, e.name))
    .filter((d) => source(d));
  const parts = subs.filter((d) => INTERNAL.test(path.basename(d)));
  const ownTokens = parts.length > 0 || fs.existsSync(path.join(abs, "tokens.css")) || fs.readdirSync(abs).some((n) => /\.(css|html)$/.test(n) && Object.keys(rootProps(fs.readFileSync(path.join(abs, n), "utf8"))).length >= 4);
  return !ownTokens && subs.length >= 2 ? subs : [abs];
}

function siblingsOf(design) {
  const parent = path.dirname(design);
  if (fs.statSync(design).isFile()) {
    return fs.readdirSync(parent).filter((n) => /\.(css|html)$/.test(n)).map((n) => path.join(parent, n)).filter((p) => p !== design);
  }
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_") && !SKIP_DIRS.has(e.name))
    .map((e) => path.join(parent, e.name))
    .filter((d) => d !== design);
}

// ---------------------------------------------------------------------------

export function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  if (flags.rules) {
    for (const r of RULES) console.log(`${r.id.padEnd(22)} ${r.severity.padEnd(6)} ${r.fix}`);
    return;
  }
  const pinned = typeof flags.house === "string" ? flags.house : null;
  const against = argv.flatMap((a, i) => (a === "--against" && argv[i + 1] ? [argv[i + 1]] : a.startsWith("--against=") ? [a.slice(10)] : []));
  const targets = positional.filter((p) => !against.includes(p) && p !== pinned);
  const designs = (targets.length ? targets : ["."]).flatMap(designsAt);

  const cache = new Map();
  const load = (p) => {
    if (!cache.has(p)) {
      let f = null;
      try {
        const src = source(p);
        if (src) f = { ...features(src), src, axes: null };
        if (f) f.axes = axesOf(f);
      } catch {
        f = null;
      }
      cache.set(p, f);
    }
    return cache.get(p);
  };
  const extra = against.flatMap((a) => designsAt(a)).filter((p) => fs.existsSync(p));

  const results = [];
  for (const d of designs) {
    const f = load(d);
    if (!f) {
      results.push({ design: display(d), error: "no tokens found: no tokens.css and no :root custom properties" });
      continue;
    }
    const siblings = [...new Set([...(flags["no-siblings"] ? [] : siblingsOf(d)), ...extra])].filter((p) => p !== d).map(load).filter((s) => s && Object.keys(s.props).length);
    const ref = pinned && load(path.resolve(ROOT, pinned));
    if (pinned && !ref) throw new Error(`--house ${pinned}: no tokens found`);
    const house = ref
      ? ref.src.tokens === f.src.tokens ? null : Object.fromEntries(Object.entries(ref.axes).filter(([, b]) => b).map(([k, b]) => [k, { bucket: b, share: ref.name }]))
      : houseOf(siblings);
    const ok = exceptions(f.src);
    const hits = [];

    const clusters = clusterHits(f);
    for (const c of clusters.filter((c) => c.hit)) hits.push({ rule: c.id, detail: c.matched.join(", ") });

    let houseMatch = null;
    if (house) {
      const axes = Object.keys(house);
      const same = axes.filter((a) => f.axes[a] === house[a].bucket);
      houseMatch = { matched: same, of: axes.length };
      if (same.length >= Math.min(HOUSE_FAIL, axes.length)) hits.push({ rule: "house-style", detail: `${same.length} of ${axes.length} axes: ${same.join(", ")}` });
    }
    for (const c of copiesOf(f, siblings)) hits.push({ rule: "token-copy", detail: `${c.shared.length} tokens from ${c.sibling}: ${c.shared.slice(0, 4).join(", ")}${c.shared.length > 4 ? ", …" : ""}` });

    results.push({
      design: f.name,
      file: f.file,
      axes: f.axes,
      clusters: clusters.map(({ id, matched, total }) => ({ id, matched, total })),
      isHouse: Boolean(pinned) && !house,
      house: house && { ...Object.fromEntries(Object.entries(house).map(([k, v]) => [k, v])), from: siblings.length },
      houseMatch,
      hits: hits.filter((h) => !ok.has(h.rule)).map((h) => ({ ...h, severity: RULE_BY_ID.get(h.rule).severity, fix: RULE_BY_ID.get(h.rule).fix })),
      allowed: hits.filter((h) => ok.has(h.rule)).map((h) => ({ ...h, ...ok.get(h.rule) })),
    });
  }

  if (flags.json) console.log(JSON.stringify({ designs: results }, null, 2));
  else print(results, makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));

  if (results.some((r) => r.hits?.length)) process.exitCode = 1;
}

function print(results, paint) {
  const out = [];
  for (const r of results) {
    if (r.error) {
      out.push(`${paint.yellow("?")} ${r.design}  ${paint.dim(r.error)}`, "");
      continue;
    }
    const mark = r.hits.length ? paint.red("✗") : r.allowed.length ? paint.yellow("~") : paint.green("✓");
    out.push(`${mark} ${paint.bold(r.design)}  ${paint.dim(r.file)}`);
    for (const [axis, bucket] of Object.entries(r.axes)) {
      const h = r.house?.[axis];
      const same = h && bucket === h.bucket;
      const note = h ? paint.dim(same ? `  = house (${h.share})` : `  house: ${h.bucket}`) : "";
      out.push(`    ${(same ? paint.yellow("●") : paint.dim("○"))} ${axis.padEnd(9)} ${bucket ?? paint.dim("not found")}${note}`);
    }
    const near = [...r.clusters].sort((a, b) => b.matched.length - a.matched.length)[0];
    if (near?.matched.length >= 2) out.push(paint.dim(`    nearest cluster: ${near.id} (${near.matched.length}/${near.total}: ${near.matched.join(", ")})`));
    if (!r.house) out.push(paint.dim(r.isHouse ? "    this is the house design" : `    house style: needs ${MIN_HISTORY}+ sibling designs; pass more with --against, or name one with --house`));
    for (const h of r.hits) out.push(`    ${paint.red("[error]")} ${h.rule.padEnd(22)} ${h.detail}`);
    for (const a of r.allowed) out.push(`    ${paint.green("[ok]   ")} ${a.rule.padEnd(22)} ${a.reason} ${paint.dim(`(${a.file})`)}`);
    out.push("");
  }
  const rules = [...new Set(results.flatMap((r) => r.hits?.map((h) => h.rule) ?? []))];
  if (rules.length) {
    out.push(paint.bold("Fixes"));
    for (const id of rules) out.push(`  ${paint.cyan(id.padEnd(22))} ${RULE_BY_ID.get(id).fix}`);
    out.push("");
  }
  const failed = results.filter((r) => r.hits?.length).length;
  out.push(failed ? paint.bold(`${failed} of ${results.length} design${results.length === 1 ? "" : "s"} ${failed === 1 ? "lands" : "land"} on a default or a sibling.`) : paint.green(`${results.length} design${results.length === 1 ? "" : "s"} checked. None land on a default or a sibling.`));
  console.log(out.join("\n"));
}
