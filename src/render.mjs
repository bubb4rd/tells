#!/usr/bin/env node
/**
 * tells render: audit the rendered DOM and computed styles in headless Chrome (zero npm dependencies).
 * Automates the measurable checks in playbook/review-checklist.md.
 *
 * Usage:
 *   tells render <file|dir|url>... [--widths 1440,960,390] [--json] [--strict] [--rule <id>] [--rules]
 *
 * Exits 1 on any error (with --strict, on any warning too).
 *
 * Env:
 *   CHROME_PATH  Optional override for the Chrome/Chromium binary.
 */
import fs from "node:fs";
import path from "node:path";
import { configFor, isWidth } from "./config.mjs";
import { CdpBrowser, findChrome, startServer, serveRootFor, fileToUrl, SETTLE_EXPR, emulateTheme, themeOf, navigate, splitRoute } from "./cdp.mjs";

const ROOT = process.cwd();
const DEFAULT_PATHS = ["."];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage", "vendor", "shots", "_assets"]);
const DEFAULT_WIDTHS = [1440, 960, 390];
const VIEWPORT_HEIGHT = 900;
// squashed-block compares a tall window with a short one: a laptop with the dock, bookmarks bar and devtools open.
const SQUASH_TALL = 1600;
const SQUASH_SHORT = 500;
const CATEGORIES = ["layout", "color", "type", "mobile", "surfaces", "media", "a11y"];

const RULES = [
  { id: "horizontal-overflow", category: "layout", severity: "error", fix: "Eliminate horizontal overflow (scrollWidth > viewport width) at every tested width." },
  { id: "clipped-text", category: "layout", severity: "warn", fix: "Prevent text clipping or descender cut-off inside overflow:hidden containers (check wrapping, width, and line-height)." },
  { id: "cramped-padding", category: "layout", severity: "warn", fix: "Give bordered/surface containers at least 8px padding on non-zero sides." },
  { id: "off-centre-label", category: "layout", severity: "warn", fix: "Centre a control's one-line label in its height (align-items: center, or equal padding); text stuck to one edge reads as cut off." },
  { id: "squashed-block", category: "layout", severity: "warn", fix: "Stop a fixed-size block shrinking when its column runs out of room in a short window: give it flex: none (or flex-shrink: 0), and let one region of the column scroll instead." },
  { id: "tall-top-nav", category: "layout", severity: "warn", fix: "Keep desktop top navigation on a single line and <= 80px tall." },
  { id: "icon-feature-grid", category: "layout", severity: "error", fix: "Replace the 3–4 card icon-on-top feature grid with real product proof, a table, or copy that fits the subject." },
  { id: "stat-strip", category: "layout", severity: "warn", fix: "Replace the row of identical big-number + tiny-label stat blocks with one focal number and the context or chart that explains it." },
  { id: "template-hero-stack", category: "layout", severity: "error", fix: "Break up the template hero stack (badge + centred headline + subline + two buttons). Lead with the product or one direct action, and drop the badge." },
  { id: "word-only-screen", category: "layout", severity: "warn", fix: "Add a visual layer that carries real information (a chart, data drawing, icon set on actions, or real imagery); word-only screens lack hierarchy." },
  { id: "low-contrast", category: "color", severity: "error", fix: "Meet WCAG AA contrast: >= 4.5:1 for normal text, >= 3:1 for large text (>= 24px or >= 18.66px bold)." },
  { id: "accent-rainbow", category: "color", severity: "warn", fix: "Avoid an accent rainbow across badges and tags. Use one accent meaning per colour, or neutral surfaces with typography." },
  { id: "tiny-text", category: "type", severity: "warn", fix: "Keep readable text >= 12px at mobile widths (and never < 10px anywhere)." },
  { id: "long-measure", category: "type", severity: "warn", fix: "Constrain multi-line prose blocks to <= 80ch for readability." },
  { id: "flat-type-hierarchy", category: "type", severity: "warn", fix: "Establish clear type hierarchy: largest heading should be >= 1.2x body font size." },
  { id: "missing-tabular-nums", category: "type", severity: "warn", fix: "Set font-variant-numeric: tabular-nums on numeric table cells and changing figures so digits align vertically." },
  { id: "eyebrow-label", category: "type", severity: "error", fix: "Drop the small tracked caps label over the heading. If what it says matters, put it in the heading or in a metadata line the reader uses." },
  { id: "mono-costume", category: "type", severity: "warn", fix: "Reserve monospace for code, tabular figures, and copyable values (IDs, hex, paths), not prose or uppercase labels." },
  { id: "small-tap-target", category: "mobile", severity: "warn", fix: "Make mobile interactive controls at least 44x44px (or expand their hit area)." },
  { id: "concentric-radius", category: "surfaces", severity: "warn", fix: "Match concentric radii on tightly inset surfaces (outerRadius = innerRadius + padding + borderWidth)." },
  { id: "gradient-edge", category: "surfaces", severity: "warn", fix: "Paint the gradient under the border too (background-origin: border-box, or `background: <gradient> border-box`). From the padding box it repeats into a transparent border, and its far end shows as a strip down the edge." },
  { id: "split-surface", category: "surfaces", severity: "error", fix: "Keep primary navigation and canvas on cohesive surfaces; avoid pairing a dark sidebar with a light page." },
  { id: "segmented-thumb", category: "surfaces", severity: "error", fix: "No raised pill on a grey track for tabs or filters. Mark the chosen option with ink and weight, or a line on the edge it sits on, in the same language as the rest of the screen." },
  { id: "nested-cards", category: "surfaces", severity: "error", fix: "Avoid cards inside cards. Use spacing, typography or a single surface level instead of nested boxes." },
  { id: "broken-image", category: "media", severity: "error", fix: "Fix broken image asset (naturalWidth === 0)." },
  { id: "duplicate-avatar", category: "media", severity: "error", fix: "Never reuse the same portrait/avatar image for two different people or duplicate the signed-in user avatar." },
  { id: "skipped-heading", category: "a11y", severity: "warn", fix: "Do not skip heading levels (e.g. h1 -> h3); step down sequentially." },
  { id: "missing-focus-ring", category: "a11y", severity: "warn", fix: "Never set outline: none/0 on :focus without a visible replacement (box-shadow, border-color, or :focus-visible ring)." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// CLI & target discovery

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [k, ...rest] = arg.slice(2).split("=");
      if (rest.length) flags[k] = rest.join("=");
      else if ((k === "rule" || k === "widths" || k === "theme") && argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** "1440,390" → [1440, 390]. Every width must be a whole number of px a screen can have. */
export function parseWidths(raw) {
  const parts = String(raw).split(",").map((s) => s.trim());
  const widths = parts.map(Number);
  const bad = parts.filter((s, i) => !isWidth(widths[i]));
  if (bad.length || !parts.length) throw new Error(`--widths takes px from 240 to 4096, like 1440,960,390; "${bad.join(",") || raw}" isn't.`);
  return widths;
}

const display = (p) => {
  if (/^https?:\/\//i.test(p)) return p;
  const rel = path.relative(ROOT, p);
  return !rel ? "." : rel.startsWith("..") ? p : rel;
};

function walkHtml(target, out) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    process.stderr.write(`tells render: skipping missing path ${display(target)}\n`);
    return;
  }
  if (stat.isFile()) {
    if (path.extname(target).toLowerCase() === ".html") out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkHtml(path.join(target, entry.name), out);
    } else if (path.extname(entry.name).toLowerCase() === ".html") {
      out.push(path.join(target, entry.name));
    }
  }
}

// ---------------------------------------------------------------------------
// In-page audit payload (executed via Runtime.evaluate)

function inPageAudit(viewportWidth, mode = "audit") {
  const findings = [];
  const allowed = [];

  // Parse tells-ok / slop-ok directives from HTML comments or data-tells-ok attributes.
  // A reason is required; bare directives do not silence a hit.
  const parseDirectives = (text) => {
    const out = [];
    if (!text) return out;
    for (const m of String(text).matchAll(/(?:tells|slop)-ok:\s*([\w-]+)(?:\s+([^\n;]*))?/gi)) {
      const reason = (m[2] || "").trim();
      if (reason) out.push({ rule: m[1].toLowerCase(), reason });
    }
    return out;
  };
  const parseDataAttr = (val) => {
    const out = [];
    if (!val) return out;
    for (const part of String(val).split(";")) {
      const s = part.trim().replace(/^(?:tells|slop)-ok:\s*/i, "");
      const m = /^([\w-]+)\s+(.+)$/.exec(s);
      if (m && m[2].trim()) out.push({ rule: m[1].toLowerCase(), reason: m[2].trim() });
    }
    return out;
  };

  // Document-level comments (in <head>, before <body>, or top-level children of <html>/<body>)
  const docDirectives = [];
  const scanTopComments = (node) => {
    if (!node) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 8) docDirectives.push(...parseDirectives(child.nodeValue));
    }
  };
  scanTopComments(document);
  scanTopComments(document.documentElement);
  scanTopComments(document.head);
  scanTopComments(document.body);
  if (document.documentElement) docDirectives.push(...parseDataAttr(document.documentElement.getAttribute("data-tells-ok") || document.documentElement.getAttribute("data-slop-ok")));
  if (document.body) docDirectives.push(...parseDataAttr(document.body.getAttribute("data-tells-ok") || document.body.getAttribute("data-slop-ok")));

  const findSuppression = (ruleId, el) => {
    const target = ruleId.toLowerCase();
    let cur = el && el.nodeType === 1 ? el : null;
    while (cur && cur.nodeType === 1) {
      const attr = cur.getAttribute("data-tells-ok") || cur.getAttribute("data-slop-ok");
      for (const d of parseDataAttr(attr)) if (d.rule === target) return d.reason;
      // Comment immediately preceding this element (ignoring whitespace text nodes)
      let prev = cur.previousSibling;
      while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
      while (prev && prev.nodeType === 8) {
        for (const d of parseDirectives(prev.nodeValue)) if (d.rule === target) return d.reason;
        prev = prev.previousSibling;
        while (prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev = prev.previousSibling;
      }
      // Direct child comments inside this element
      for (const child of cur.childNodes) {
        if (child.nodeType === 8) {
          for (const d of parseDirectives(child.nodeValue)) if (d.rule === target) return d.reason;
        }
      }
      cur = cur.parentElement;
    }
    for (const d of docDirectives) if (d.rule === target) return d.reason;
    return null;
  };

  const add = (rule, where, detail, el = null) => {
    const reason = findSuppression(rule, el);
    if (reason) allowed.push({ rule, where, detail, reason });
    else findings.push({ rule, where, detail });
  };

  // Selector builder for concise, readable locations
  const describe = (el) => {
    if (!el || el === document.documentElement) return "html";
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (typeof el.className === "string" && el.className.trim()) {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) s += `.${cls}`;
    }
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return text ? `${s} "${text}"` : s;
  };

  // Visibility helper
  // A closed dialog or menu faded to opacity 0 (or marked aria-hidden / inert) hides its whole subtree,
  // but its children keep opacity 1, so they'd be audited (and score 1:1 contrast) without this.
  const hiddenTree = new Map();
  const inHiddenTree = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (hiddenTree.has(el)) return hiddenTree.get(el);
    const cs = getComputedStyle(el);
    const hidden = el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert") || parseFloat(cs.opacity) === 0 || inHiddenTree(el.parentElement);
    hiddenTree.set(el, hidden);
    return hidden;
  };
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (inHiddenTree(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") return false;
    return true;
  };

  // Color parsing via 1x1 canvas so oklch()/lab()/color-mix()/rgba() all normalize to sRGB RGBA
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();
  const parseColor = (str) => {
    if (!str || str === "transparent") return [0, 0, 0, 0];
    if (colorCache.has(str)) return colorCache.get(str);
    ctx2d.clearRect(0, 0, 1, 1);
    ctx2d.fillStyle = "rgba(0,0,0,0)";
    ctx2d.fillStyle = str;
    ctx2d.fillRect(0, 0, 1, 1);
    const d = ctx2d.getImageData(0, 0, 1, 1).data;
    const res = [d[0], d[1], d[2], d[3] / 255];
    colorCache.set(str, res);
    return res;
  };

  const blend = (fg, bg) => {
    const a = fg[3];
    const outA = a + bg[3] * (1 - a);
    if (outA === 0) return [255, 255, 255, 1];
    return [
      (fg[0] * a + bg[0] * bg[3] * (1 - a)) / outA,
      (fg[1] * a + bg[1] * bg[3] * (1 - a)) / outA,
      (fg[2] * a + bg[2] * bg[3] * (1 - a)) / outA,
      outA,
    ];
  };

  const luminance = ([r, g, b]) => {
    const lin = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };

  const contrastRatio = (c1, c2) => {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const rgbToHsl = ([r, g, b]) => {
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
  };

  const colorSpread = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
  const colorDist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  const hueGroups = (hues, gap = 30) => {
    const sorted = [...hues].sort((a, b) => a - b);
    if (!sorted.length) return [];
    const groups = [[sorted[0]]];
    for (const h of sorted.slice(1)) {
      const last = groups[groups.length - 1];
      if (h - last[last.length - 1] <= gap) last.push(h);
      else groups.push([h]);
    }
    if (groups.length > 1 && sorted[0] + 360 - sorted[sorted.length - 1] <= gap) groups[0].push(...groups.pop());
    return groups.map((g) => g[0]);
  };

  const isMonoFamily = (ff) => {
    if (!ff) return false;
    const first = ff.split(",")[0].replace(/["']/g, "").trim();
    return /\b(?:mono|monospace|courier|menlo|consolas|iosevka|monaco|source code|fira code|jetbrains|sf mono|roboto mono|ibm plex mono|geist mono)\b/i.test(first);
  };

  const looksLikeCodeOrValue = (s) => {
    if (s.length < 4) return true;
    if (/^[+\-−$€£¥#]?\d[\d\s,.:/%x×°′″–-]*[a-z%]*$/i.test(s)) return true;
    if (/[\/\\{}()[\];=<>@`$]|^https?:|^0x[0-9a-f]+$|^#[0-9a-f]{3,8}$|^[A-Z0-9_]{2,}-[A-Z0-9_-]+$/i.test(s)) return true;
    return false;
  };

  const effectiveBg = (el) => {
    const layers = [];
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // skip gradient/photo backgrounds
      const bg = parseColor(cs.backgroundColor);
      const op = parseFloat(cs.opacity);
      if (bg[3] > 0) layers.push([bg[0], bg[1], bg[2], bg[3] * op]);
      cur = cur.parentElement;
    }
    let acc = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) acc = blend(layers[i], acc);
    return acc;
  };

  const effectiveOpacity = (el) => {
    let op = 1;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      op *= parseFloat(getComputedStyle(cur).opacity);
      cur = cur.parentElement;
    }
    return op;
  };

  // squashed-block runs in two passes over a page that's already loaded: "squash-mark" in a tall window records
  // every fixed-size block in a column whose height follows the window, "squash-check" in a short one finds those
  // that shrank. A block with flex-grow is meant to take up the slack, and a scroll region is meant to shrink.
  if (mode === "squash-mark") {
    const marks = [];
    for (const el of document.querySelectorAll("body *")) {
      const parent = el.parentElement;
      if (!parent || inHiddenTree(el)) continue;
      const pcs = getComputedStyle(parent);
      if (!/flex/.test(pcs.display) || !pcs.flexDirection.startsWith("column")) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") continue;
      if (parseFloat(cs.flexGrow) > 0 || parseFloat(cs.flexShrink) === 0) continue;
      if (/(auto|scroll)/.test(cs.overflowY)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 16 || r.width < 16) continue;
      marks.push({ el, h: r.height, ph: parent.getBoundingClientRect().height });
    }
    window.__tellsSquash = { marks };
    return { findings, allowed, fingerprint: null };
  }
  if (mode === "squash-check") {
    const { marks = [] } = window.__tellsSquash || {};
    // One hit per column: the shortfall is shared out across every block that can shrink, so each one may lose
    // only a few pixels. Report the column at the block that lost the most.
    const columns = new Map();
    for (const m of marks) {
      if (!m.el.isConnected) continue;
      const parent = m.el.parentElement;
      if (parent.getBoundingClientRect().height > m.ph - 4) continue;
      const lost = m.h - m.el.getBoundingClientRect().height;
      const col = columns.get(parent) || { n: 0, worst: null, short: 0 };
      // Every pixel the column's blocks gave up is room it was short; auto margins are already 0 here.
      if (lost > 0) col.short += lost;
      if (lost < 2) { columns.set(parent, col); continue; }
      col.n++;
      if (!col.worst || lost > col.worst.lost) col.worst = { el: m.el, h: m.h, lost };
      columns.set(parent, col);
    }
    const flagged = [];
    for (const [parent, col] of columns) {
      if (!col.worst) continue;
      if (flagged.some((f) => f.contains(parent))) continue;
      flagged.push(parent);
      const { el, h, lost } = col.worst;
      // The column follows the window, so it fits again once the window is as much taller as it was short.
      const below = Math.round(window.innerHeight + col.short);
      const others = col.n > 1 ? `, and ${col.n - 1} more block${col.n > 2 ? "s" : ""} in its column` : "";
      add("squashed-block", describe(el), `${Math.round(h)}px tall, squashed to ${Math.round(h - lost)}px in a ${window.innerHeight}px-high window${others} (starts below about ${below}px)`, el);
      if (flagged.length >= 6) break;
    }
    delete window.__tellsSquash;
    return { findings, allowed, fingerprint: null };
  }

  // 1. Horizontal overflow
  const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
  if (docOverflow > 1) {
    add("horizontal-overflow", "document", `scrollWidth ${document.documentElement.scrollWidth}px > viewport ${window.innerWidth}px (+${Math.round(docOverflow)}px)`, document.documentElement);
  }

  const all = [...document.querySelectorAll("body *")];
  const measureCanvas = document.createElement("canvas").getContext("2d");

  // 2. Contrast, tiny text, clipped text, long measure, cramped padding, structural signals
  const bodySizes = [];
  const headingSizes = [];
  const headingLevels = [];
  const seenLowContrast = new Set();
  const seenTiny = new Set();
  const seenClipped = new Set();
  const seenTap = new Set();
  const seenCramped = new Set();
  const seenOffCentre = new Set();
  const seenGradientEdge = new Set();
  const seenConcentric = new Set();
  const seenMono = new Set();
  const avatarSources = new Map();
  const cardEls = new Map();
  const badgeHues = [];
  let visibleCount = 0;
  let hasVisualLayer = false;

  const NON_CARD_TAG = /^(html|body|main|header|footer|nav|aside|table|thead|tbody|tfoot|tr|td|th|form|fieldset|button|a|input|select|textarea|label|dialog|ul|ol|dl|pre|code|canvas|svg)$/;
  const CODE_TAG = /^(code|pre|kbd|samp|var|input|textarea|td|th)$/;

  for (const el of all) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Visual layer tracking (before skipping svg internals)
    if (tag === "svg" && rect.width >= 12 && rect.height >= 12) hasVisualLayer = true;
    if (tag === "canvas" || tag === "video" || tag === "picture" || tag === "progress" || tag === "meter" || el.getAttribute("role") === "progressbar") hasVisualLayer = true;
    if (cs.backgroundImage && /url\(/i.test(cs.backgroundImage)) hasVisualLayer = true;

    if (tag === "svg" || el.closest("svg")) continue;
    visibleCount++;

    // Direct visible text node?
    let directText = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) directText += n.nodeValue;
    }
    directText = directText.replace(/\s+/g, " ").trim();

    if (directText) {
      const fs = parseFloat(cs.fontSize);
      const fw = parseInt(cs.fontWeight, 10) || 400;
      if (/^h[1-6]$/.test(tag)) {
        headingSizes.push(fs);
      } else if (tag === "p" || tag === "li" || tag === "td" || tag === "dd" || tag === "span" || tag === "div") {
        if (directText.length >= 12) bodySizes.push(fs);
      }

      // Tiny text
      const minFs = viewportWidth <= 480 ? 12 : 10;
      if (fs < minFs - 0.1) {
        const key = `${tag}.${el.className}:${Math.round(fs * 10)}`;
        if (!seenTiny.has(key) && seenTiny.size < 8) {
          seenTiny.add(key);
          add("tiny-text", describe(el), `${fs.toFixed(1)}px (< ${minFs}px at ${viewportWidth}px)`, el);
        }
      }

      // WCAG contrast (skip disabled controls)
      const disabled = el.matches(":disabled, [aria-disabled='true']") || Boolean(el.closest(":disabled, [aria-disabled='true']"));
      if (!disabled && rect.width >= 4 && rect.height >= 4) {
        const bg = effectiveBg(el);
        if (bg) {
          const rawFg = parseColor(cs.color);
          const op = effectiveOpacity(el);
          const fg = blend([rawFg[0], rawFg[1], rawFg[2], rawFg[3] * op], bg);
          const ratio = contrastRatio(fg, bg);
          const isLarge = fs >= 24 || (fs >= 18.66 && fw >= 700);
          const req = isLarge ? 3.0 : 4.5;
          if (ratio < req - 0.05) {
            const key = `${tag}.${el.className}:${Math.round(ratio * 10)}`;
            if (!seenLowContrast.has(key) && seenLowContrast.size < 10) {
              seenLowContrast.add(key);
              add("low-contrast", describe(el), `contrast ${ratio.toFixed(2)}:1 (needs >= ${req}:1, ${fs.toFixed(0)}px)`, el);
            }
          }
        }
      }

      // Clipped text & descender clipping
      const ovX = cs.overflowX;
      const ovY = cs.overflowY;
      const horizClip = (ovX === "hidden" || ovX === "clip") && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
      const vertClip = (ovY === "hidden" || ovY === "clip") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0;
      if (horizClip || vertClip) {
        const key = `${describe(el)}`;
        if (!seenClipped.has(key) && seenClipped.size < 8) {
          seenClipped.add(key);
          const axis = horizClip && vertClip ? "width & height" : horizClip ? `width (${el.scrollWidth}px > ${el.clientWidth}px)` : `height (${el.scrollHeight}px > ${el.clientHeight}px)`;
          add("clipped-text", describe(el), `text clipped on ${axis}`, el);
        }
      }

      // Mono as costume (monospace on prose, headings, or uppercase/tracked UI labels outside code)
      if (!CODE_TAG.test(tag) && !el.closest("pre, code, kbd, samp") && isMonoFamily(cs.fontFamily) && !looksLikeCodeOrValue(directText)) {
        const words = directText.match(/[A-Za-z]{2,}/g) || [];
        const ls = parseFloat(cs.letterSpacing) || 0;
        const isTrackedOrCaps = cs.textTransform === "uppercase" || ls >= 0.5;
        if (words.length >= 4 || (words.length >= 2 && (isTrackedOrCaps || /^h[1-6]$/.test(tag)))) {
          const key = `${tag}.${el.className}:${directText.slice(0, 20)}`;
          if (!seenMono.has(key) && seenMono.size < 6) {
            seenMono.add(key);
            add("mono-costume", describe(el), `monospace used on non-code ${/^h[1-6]$/.test(tag) ? "heading" : isTrackedOrCaps ? "label" : "prose"}`, el);
          }
        }
      }
    }

    // Heading sequence tracking
    if (/^h[1-6]$/.test(tag)) {
      headingLevels.push({ level: Number(tag[1]), el });
    }

    // Eyebrow: a short, small, tracked caps label straight above a heading, whatever the markup calls it
    if (/^h[1-3]$/.test(tag)) {
      let prev = el.previousElementSibling;
      while (prev && !(prev.textContent || "").trim()) prev = prev.previousElementSibling;
      if (prev && !prev.matches("h1, h2, h3, h4, h5, h6, nav, header, ul, ol, table, form, img, svg")) {
        const pcs = getComputedStyle(prev);
        const text = (prev.textContent || "").replace(/\s+/g, " ").trim();
        const letters = text.replace(/[^A-Za-z]/g, "");
        const caps = pcs.textTransform === "uppercase" || (letters.length >= 3 && letters === letters.toUpperCase());
        const ls = parseFloat(pcs.letterSpacing) || 0;
        const size = parseFloat(pcs.fontSize) || 16;
        const headSize = parseFloat(cs.fontSize) || 16;
        const prect = prev.getBoundingClientRect();
        if (caps && ls >= size * 0.04 && size <= 15 && size <= headSize * 0.6 && text.length >= 2 && text.length <= 72 && prect.height > 0 && prect.bottom <= rect.top + 4) {
          add("eyebrow-label", describe(prev), `"${text.slice(0, 40)}" over ${tag}`, prev);
        }
      }
    }

    // Long prose measure (> 80ch on multi-line paragraphs)
    if ((tag === "p" || tag === "blockquote" || tag === "dd") && (el.textContent || "").trim().length >= 85) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      if (rect.height >= lh * 1.8) {
        measureCanvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const ch = measureCanvas.measureText("0").width || parseFloat(cs.fontSize) * 0.55;
        const innerW = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const chars = innerW / ch;
        if (chars > 82) {
          add("long-measure", describe(el), `~${Math.round(chars)}ch wide (limit 80ch)`, el);
        }
      }
    }

    // Mobile tap targets (< 44x44)
    if (viewportWidth <= 480 && el.matches('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]')) {
      const inProse = tag === "a" && Boolean(el.closest("p, li, dd, blockquote"));
      // A checkbox or radio is tapped through its label: measure the label, not the box.
      let hit = rect;
      if (tag === "input" && /^(checkbox|radio)$/i.test(el.type)) {
        const label = el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (label && isVisible(label)) {
          const lr = label.getBoundingClientRect();
          const left = Math.min(rect.left, lr.left), top = Math.min(rect.top, lr.top);
          hit = { width: Math.max(rect.right, lr.right) - left, height: Math.max(rect.bottom, lr.bottom) - top };
        }
      }
      if (!inProse && (hit.width < 43.5 || hit.height < 43.5)) {
        const key = `${tag}.${el.className}:${Math.round(hit.width)}x${Math.round(hit.height)}`;
        if (!seenTap.has(key) && seenTap.size < 10) {
          seenTap.add(key);
          add("small-tap-target", describe(el), `${Math.round(hit.width)}x${Math.round(hit.height)}px (< 44x44px)`, el);
        }
      }
    }

    // Cramped padding on bordered/surface containers (cards/panels >= 160x80)
    if (rect.width >= 160 && rect.height >= 80 && !/^(table|thead|tbody|tr|img|canvas|video)$/.test(tag)) {
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 && parseColor(cs.borderTopColor)[3] > 0.02;
      const hasBg = parseColor(cs.backgroundColor)[3] > 0.02;
      if (hasBorder || hasBg) {
        const pads = [parseFloat(cs.paddingTop), parseFloat(cs.paddingRight), parseFloat(cs.paddingBottom), parseFloat(cs.paddingLeft)].filter((p) => p > 0);
        if (pads.length && Math.min(...pads) < 7.5 && (el.children.length > 0 || directText)) {
          const minP = Math.min(...pads);
          const key = `${tag}.${el.className}:${Math.round(minP)}`;
          if (!seenCramped.has(key) && seenCramped.size < 6) {
            seenCramped.add(key);
            add("cramped-padding", describe(el), `min non-zero padding ${minP.toFixed(0)}px (< 8px)`, el);
          }
        }
      }
    }

    // A one-line control label stuck to one edge of a taller control: a stretched tab or button whose text sits at its top
    if (rect.height >= 28 && rect.width >= 16 && el.matches('button, a[href], [role="tab"], [role="button"]') && el.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (lines.length) {
        const top = Math.min(...lines.map((r) => r.top));
        const bottom = Math.max(...lines.map((r) => r.bottom));
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        if (bottom - top <= lh * 1.3) {
          const above = top - rect.top;
          const below = rect.bottom - bottom;
          if (Math.abs(above - below) >= 8 && Math.min(above, below) < Math.max(above, below) / 3) {
            const key = `${tag}.${el.className}`;
            if (!seenOffCentre.has(key) && seenOffCentre.size < 6) {
              seenOffCentre.add(key);
              add("off-centre-label", describe(el), `${Math.round(above)}px above the text, ${Math.round(below)}px below`, el);
            }
          }
        }
      }
    }

    // A gradient painted from the padding box (the default) repeats into a transparent or see-through border, so its
    // far end shows as a strip down the opposite edge. Only the top background layer is read.
    if (rect.width >= 16 && rect.height >= 12 && /gradient\(/.test(cs.backgroundImage)) {
      const first = (v) => String(v).split(",")[0].trim();
      if (first(cs.backgroundOrigin) === "padding-box" && first(cs.backgroundClip) === "border-box") {
        const sides = ["Top", "Right", "Bottom", "Left"].filter((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none" && parseColor(cs[`border${side}Color`])[3] < 0.95);
        if (sides.length) {
          const key = `${tag}.${el.className}`;
          if (!seenGradientEdge.has(key) && seenGradientEdge.size < 6) {
            seenGradientEdge.add(key);
            add("gradient-edge", describe(el), `${parseFloat(cs[`border${sides[0]}Width`])}px see-through border on ${sides.map((x) => x.toLowerCase()).join(", ")}, gradient starts inside it`, el);
          }
        }
      }
    }

    // Track card-like bounded surfaces for nested-cards check
    if (!NON_CARD_TAG.test(tag) && rect.width >= 140 && rect.height >= 64 && rect.width < viewportWidth - 20) {
      const allBorders =
        parseFloat(cs.borderTopWidth) >= 0.75 && parseColor(cs.borderTopColor)[3] > 0.05 &&
        parseFloat(cs.borderRightWidth) >= 0.75 && parseColor(cs.borderRightColor)[3] > 0.05 &&
        parseFloat(cs.borderBottomWidth) >= 0.75 && parseColor(cs.borderBottomColor)[3] > 0.05 &&
        parseFloat(cs.borderLeftWidth) >= 0.75 && parseColor(cs.borderLeftColor)[3] > 0.05;
      const hasShadow = cs.boxShadow && cs.boxShadow !== "none";
      let distinctBg = false;
      const ownBg = parseColor(cs.backgroundColor);
      if (ownBg[3] > 0.04) {
        const pBg = effectiveBg(el.parentElement);
        const eff = pBg ? blend(ownBg, pBg) : ownBg;
        if (pBg && colorDist(eff, pBg) >= 12) distinctBg = true;
      }
      if (allBorders || hasShadow || distinctBg) cardEls.set(el, rect);
    }

    // Collect badge/tag/chip hues for accent-rainbow (desktop)
    if (viewportWidth >= 960 && rect.width >= 20 && rect.width <= 200 && rect.height >= 14 && rect.height <= 40 && !el.closest("thead")) {
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (txt.length >= 2 && txt.length <= 32 && el.children.length <= 2) {
        const ownBg = parseColor(cs.backgroundColor);
        const hasBorder = parseFloat(cs.borderTopWidth) >= 0.75 && parseColor(cs.borderTopColor)[3] > 0.05;
        const badgeClass = typeof el.className === "string" && /\b(?:badge|tag|chip|pill|status|label)\b/i.test(el.className);
        if (ownBg[3] > 0.05 || hasBorder || badgeClass) {
          const pBg = effectiveBg(el.parentElement) || [255, 255, 255, 1];
          const bg = ownBg[3] > 0.05 ? blend(ownBg, pBg) : null;
          const fg = parseColor(cs.color);
          for (const c of [bg, fg]) {
            if (!c) continue;
            const h = rgbToHsl(c);
            if (h.s >= 0.35 && h.l >= 0.18 && h.l <= 0.90 && colorSpread(c) >= 24) {
              badgeHues.push(h.h);
              break;
            }
          }
        }
      }
    }

    // Concentric border radius on tightly inset rounded child inside rounded parent
    const rOuter = parseFloat(cs.borderTopLeftRadius);
    if (rOuter >= 4 && rOuter < Math.min(rect.width, rect.height) / 2 - 2) {
      const pt = parseFloat(cs.paddingTop);
      const pr = parseFloat(cs.paddingRight);
      const pb = parseFloat(cs.paddingBottom);
      const pl = parseFloat(cs.paddingLeft);
      const uniformPad = pt >= 4 && pt <= 24 && Math.max(pt, pr, pb, pl) - Math.min(pt, pr, pb, pl) <= 2;
      if (uniformPad) {
        const bw = parseFloat(cs.borderTopWidth) || 0;
        for (const child of el.children) {
          if (!isVisible(child)) continue;
          const ccs = getComputedStyle(child);
          const cr = child.getBoundingClientRect();
          const rInner = parseFloat(ccs.borderTopLeftRadius);
          const isChildPill = rInner >= Math.min(cr.width, cr.height) / 2 - 2;
          const childHasSurface = parseColor(ccs.backgroundColor)[3] > 0.02 || (parseFloat(ccs.borderTopWidth) > 0 && parseColor(ccs.borderTopColor)[3] > 0.02);
          const innerSpan = rect.width - pl - pr - bw * 2;
          const hugsCorners = cr.width >= innerSpan * 0.85 && (Math.abs((cr.top - rect.top) - (pt + bw)) <= 4 || Math.abs((rect.bottom - cr.bottom) - (pb + bw)) <= 4);
          if (rInner >= 2 && !isChildPill && childHasSurface && hugsCorners) {
            const expected = rInner + pt + bw;
            if (Math.abs(rOuter - expected) > 2.5) {
              const key = `${Math.round(rOuter)}/${Math.round(rInner)}/${Math.round(pt)}`;
              if (!seenConcentric.has(key) && seenConcentric.size < 6) {
                seenConcentric.add(key);
                add("concentric-radius", `${describe(el)} > ${describe(child)}`, `outer ${rOuter}px vs inner ${rInner}px + pad ${pt}px (expected ~${Math.round(expected)}px)`, child);
              }
            }
            break;
          }
        }
      }
    }

    // Broken & duplicate avatar images
    if (tag === "img") {
      if (!el.complete || el.naturalWidth === 0) {
        add("broken-image", describe(el), `broken src="${el.getAttribute("src") || ""}"`, el);
      } else {
        hasVisualLayer = true;
        const src = el.currentSrc || el.getAttribute("src") || "";
        const aspect = rect.width / Math.max(1, rect.height);
        const looksLikeAvatar =
          /people|avatar|portrait|face|headshot|user/i.test(`${src} ${el.className} ${el.alt}`) ||
          (rect.width <= 96 && rect.height <= 96 && aspect >= 0.8 && aspect <= 1.25 && parseFloat(cs.borderTopLeftRadius) >= rect.width * 0.25);
        if (looksLikeAvatar && src) {
          if (!avatarSources.has(src)) avatarSources.set(src, []);
          avatarSources.get(src).push({ loc: describe(el), el });
        }
      }
    }

    // Desktop top nav height <= 80px and single line
    if (viewportWidth >= 960 && (tag === "header" || tag === "nav") && rect.top < 120 && rect.width >= viewportWidth * 0.6) {
      if (rect.height > 82) {
        add("tall-top-nav", describe(el), `top nav height ${Math.round(rect.height)}px (> 80px)`, el);
      } else {
        const navLinks = [...el.querySelectorAll("a, button")].filter(isVisible);
        if (navLinks.length >= 3) {
          const tops = navLinks.map((n) => Math.round(n.getBoundingClientRect().top));
          if (Math.max(...tops) - Math.min(...tops) > 20) {
            add("tall-top-nav", describe(el), `top nav items wrap onto multiple lines (vertical spread ${Math.max(...tops) - Math.min(...tops)}px)`, el);
          }
        }
      }
    }
  }

  // Nested cards (bounded surface inside another bounded surface)
  const seenNested = new Set();
  for (const [el, er] of cardEls) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      if (cardEls.has(p)) {
        const pr = cardEls.get(p);
        if (pr.width - er.width >= 8 || pr.height - er.height >= 8) {
          const key = `${describe(p)}>${describe(el)}`;
          if (!seenNested.has(key) && seenNested.size < 4) {
            seenNested.add(key);
            add("nested-cards", `${describe(p)} > ${describe(el)}`, "card/panel surface nested inside another card", el);
          }
        }
        break;
      }
      p = p.parentElement;
    }
  }

  // Segmented thumb: a filled track holding one row of choices, the chosen one a raised, lighter pill
  // (the stock tabs of every component kit). Hover and focus don't count: only one option has a surface.
  {
    const seenSeg = new Set();
    const chDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const CHOICE = 'button, a[href], [role="tab"], [role="radio"], [role="option"], label';
    for (const track of all) {
      if (seenSeg.size >= 4) break;
      if (!isVisible(track) || !track.parentElement) continue;
      const visibleKids = [...track.children].filter(isVisible);
      if (visibleKids.length < 2 || visibleKids.length > 8 || !visibleKids.every((c) => c.matches(CHOICE))) continue;
      const tr = track.getBoundingClientRect();
      if (tr.height > 56 || tr.width < 80) continue;
      const trackBg = parseColor(getComputedStyle(track).backgroundColor);
      if (trackBg[3] < 0.04) continue;
      const parentBg = effectiveBg(track.parentElement);
      if (!parentBg) continue;
      const trackEff = blend(trackBg, parentBg);
      if (chDiff(trackEff, parentBg) < 4) continue;
      const top = visibleKids[0].getBoundingClientRect().top;
      if (!visibleKids.every((k) => Math.abs(k.getBoundingClientRect().top - top) <= 4)) continue;
      const raised = visibleKids.filter((k) => {
        const b = parseColor(getComputedStyle(k).backgroundColor);
        return b[3] > 0.04 && chDiff(blend(b, trackEff), trackEff) >= 4;
      });
      if (raised.length !== 1) continue;
      const key = describe(track);
      if (seenSeg.has(key)) continue;
      seenSeg.add(key);
      add("segmented-thumb", `${key} > ${describe(raised[0])}`, "the chosen option is a raised pill on a filled track", raised[0]);
    }
  }

  // Desktop structural checks: split-surface, icon-feature-grid, stat-strip, template-hero-stack, accent-rainbow, word-only-screen
  if (viewportWidth >= 960) {
    // Split surface: dark sidebar/rail paired with light canvas (or vice versa)
    const canvasEl = document.querySelector("main") || document.body;
    const canvasBg = effectiveBg(canvasEl) || effectiveBg(document.body);
    if (canvasBg) {
      const canvasLum = luminance(canvasBg);
      const seenSplit = new Set();
      const sideCandidates = document.querySelectorAll('aside, nav, [role="navigation"], [class*="sidebar" i], [class*="rail" i], [id*="sidebar" i]');
      for (const el of sideCandidates) {
        if (!isVisible(el) || el.contains(canvasEl)) continue;
        const r = el.getBoundingClientRect();
        const isRail = r.width >= 140 && r.width <= viewportWidth * 0.36 && r.height >= Math.min(window.innerHeight * 0.55, 420) && (r.left <= 48 || r.right >= viewportWidth - 48);
        if (!isRail) continue;
        const sideBg = effectiveBg(el);
        if (!sideBg) continue;
        const sideLum = luminance(sideBg);
        const clashes = (sideLum < 0.08 && canvasLum > 0.65) || (canvasLum < 0.08 && sideLum > 0.65);
        if (clashes && seenSplit.size < 2) {
          const key = describe(el);
          if (!seenSplit.has(key)) {
            seenSplit.add(key);
            add("split-surface", key, `dark/light surface split (sidebar lum ${sideLum.toFixed(2)} vs canvas lum ${canvasLum.toFixed(2)})`, el);
          }
        }
      }
    }

    // Horizontal sibling rows: icon-feature-grid & stat-strip
    const seenFeatureGrid = new Set();
    const seenStatStrip = new Set();
    const rowContainers = [document.body, ...all];
    for (const parent of rowContainers) {
      if (!isVisible(parent)) continue;
      const kids = [...parent.children].filter(isVisible).map((el) => ({ el, r: el.getBoundingClientRect() }));
      if (kids.length < 3 || kids.length > 8) continue;
      // Group children into horizontal rows by top coordinate
      const rows = [];
      for (const k of kids) {
        const row = rows.find((g) => Math.abs(g[0].r.top - k.r.top) <= 16);
        if (row) row.push(k);
        else rows.push([k]);
      }
      for (const row of rows) {
        if (row.length !== 3 && row.length !== 4) continue;
        const widths = row.map((x) => x.r.width);
        const minW = Math.min(...widths);
        const maxW = Math.max(...widths);
        if (minW < 100 || maxW / minW > 1.25) continue;

        // Icon-on-top feature grid: 3-4 cards, icon box at top + short title + short body copy
        if (minW >= 160 && seenFeatureGrid.size < 2 && ![...seenFeatureGrid].some((p) => p.contains(parent))) {
          let matches = 0;
          for (const { el: card, r: cr } of row) {
            if (cr.height < 100 || card.querySelector("table, input, select, textarea, canvas")) continue;
            if (card.querySelectorAll("a[href], button").length > 1) continue;
            // Icon or tinted icon box in top half
            const iconCandidates = card.querySelectorAll("svg, img, div, span");
            let hasTopIcon = false;
            for (const ic of iconCandidates) {
              if (!isVisible(ic)) continue;
              const ir = ic.getBoundingClientRect();
              if (ir.bottom > cr.top + cr.height * 0.6) continue;
              const t = ic.tagName.toLowerCase();
              if ((t === "svg" || t === "img") && ir.width >= 14 && ir.width <= 64 && ir.height >= 14 && ir.height <= 64) {
                hasTopIcon = true;
                break;
              }
              if ((t === "div" || t === "span") && ir.width >= 24 && ir.width <= 64 && ir.height >= 24 && ir.height <= 64) {
                const ratio = ir.width / Math.max(1, ir.height);
                const ics = getComputedStyle(ic);
                const hasBox = parseColor(ics.backgroundColor)[3] > 0.04 || parseFloat(ics.borderTopWidth) >= 0.75;
                if (ratio >= 0.75 && ratio <= 1.33 && hasBox) {
                  hasTopIcon = true;
                  break;
                }
              }
            }
            if (!hasTopIcon) continue;
            // Short heading/title + short description
            const titleEl = [...card.querySelectorAll("h2, h3, h4, h5, h6, strong, [class*='title' i]")].find((t) => {
              const s = (t.textContent || "").trim();
              return isVisible(t) && s.length >= 3 && s.length <= 45;
            });
            if (!titleEl) continue;
            const totalTxt = (card.textContent || "").replace(/\s+/g, " ").trim();
            const titleTxt = (titleEl.textContent || "").trim();
            const bodyLen = totalTxt.length - titleTxt.length;
            if (bodyLen >= 18 && bodyLen <= 240) matches++;
          }
          if (matches >= 3) {
            seenFeatureGrid.add(parent);
            add("icon-feature-grid", describe(parent), `${matches} cards with icon-on-top + title + short copy`, parent);
          }
        }

        // Stat strip: 3-4 equal blocks with oversized figure + tiny uppercase/tracked label
        if (seenStatStrip.size < 2 && ![...seenStatStrip].some((p) => p.contains(parent))) {
          let matches = 0;
          for (const { el: item, r: ir } of row) {
            if (ir.height > 220 || item.querySelector("table, input, select, textarea, canvas")) continue;
            const full = (item.textContent || "").replace(/\s+/g, " ").trim();
            if (!full || full.length > 70) continue;
            let numFs = 0;
            let labelFs = Infinity;
            let labelStyled = false;
            const nodes = [item, ...item.querySelectorAll("*")];
            for (const n of nodes) {
              if (!isVisible(n)) continue;
              let dt = "";
              for (const ch of n.childNodes) if (ch.nodeType === 3) dt += ch.nodeValue;
              dt = dt.replace(/\s+/g, " ").trim();
              if (!dt) continue;
              const ncs = getComputedStyle(n);
              const fs = parseFloat(ncs.fontSize);
              if (/\d/.test(dt) && dt.length <= 16 && fs >= 22) {
                numFs = Math.max(numFs, fs);
              } else if (/[A-Za-z]{2,}/.test(dt) && dt.length <= 36 && fs <= 13.5) {
                const ls = parseFloat(ncs.letterSpacing) || 0;
                if (ncs.textTransform === "uppercase" || ls >= 0.5) {
                  labelFs = Math.min(labelFs, fs);
                  labelStyled = true;
                }
              }
            }
            if (numFs >= 22 && labelStyled && numFs / labelFs >= 1.75) matches++;
          }
          if (matches >= 3) {
            seenStatStrip.add(parent);
            add("stat-strip", describe(parent), `row of ${matches} big-number + tiny-label stat blocks`, parent);
          }
        }
      }
    }

    // Template hero stack: centred eyebrow/badge + h1 + subline + >= 2 CTA buttons above the fold
    const firstH1 = [...document.querySelectorAll("h1")].find((el) => isVisible(el) && el.getBoundingClientRect().top < 700);
    if (firstH1) {
      const h1r = firstH1.getBoundingClientRect();
      const h1cs = getComputedStyle(firstH1);
      const h1Fs = parseFloat(h1cs.fontSize);
      const h1Centered = h1cs.textAlign === "center" || Math.abs((h1r.left + h1r.width / 2) - viewportWidth / 2) <= 60;
      if (h1Fs >= 32 && h1Centered) {
        let hero = firstH1.parentElement;
        while (hero && hero.parentElement && hero.parentElement !== document.body && hero.parentElement.getBoundingClientRect().height <= 850) {
          hero = hero.parentElement;
          if (hero.tagName === "SECTION" || hero.tagName === "HEADER") break;
        }
        if (hero) {
          const hasEyebrow = [...hero.querySelectorAll("*")].some((el) => {
            if (!isVisible(el) || el === firstH1 || el.contains(firstH1) || el.closest("nav")) return false;
            const r = el.getBoundingClientRect();
            const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
            const fs = parseFloat(getComputedStyle(el).fontSize);
            return r.bottom <= h1r.top + 8 && r.height <= 42 && r.width <= 420 && fs <= 14.5 && txt.length >= 3 && txt.length <= 60 && el.querySelectorAll("a, button").length <= 1;
          });
          const hasSubline = [...hero.querySelectorAll("p, div, span")].some((el) => {
            if (!isVisible(el) || el.contains(firstH1) || el.closest("a, button")) return false;
            const r = el.getBoundingClientRect();
            const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
            return r.top >= h1r.bottom - 4 && r.top <= h1r.bottom + 180 && txt.length >= 25 && txt.length <= 360 && el.querySelectorAll("a, button").length === 0;
          });
          const ctas = [...hero.querySelectorAll("a[href], button")].filter((el) => {
            if (!isVisible(el) || el.closest("nav")) return false;
            const r = el.getBoundingClientRect();
            return r.top >= h1r.bottom - 4 && r.top <= h1r.bottom + 360;
          });
          const hasButtonPair = ctas.length >= 2 && ctas.some((a, idx) => ctas.slice(idx + 1).some((b) => Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) <= 24));
          if (hasEyebrow && hasSubline && hasButtonPair) {
            add("template-hero-stack", describe(hero), "centred badge/eyebrow + headline + subline + two CTA buttons", hero);
          }
        }
      }
    }

    // Accent rainbow: 4+ distinct saturated hue families across badges/tags
    const rainbowGroups = hueGroups(badgeHues, 30);
    if (rainbowGroups.length >= 4) {
      add("accent-rainbow", "document", `${rainbowGroups.length} distinct saturated hue families across badges/tags`, document.body);
    }

    // Word-only screen: substantial page with zero imagery, icons, or data visuals
    if (!hasVisualLayer && visibleCount >= 15) {
      const bodyTextLen = (document.body.innerText || "").replace(/\s+/g, " ").trim().length;
      if (bodyTextLen >= 600) {
        add("word-only-screen", "document", `substantial screen (${bodyTextLen} chars) with no imagery, icons, or data visuals`, document.body);
      }
    }
  }

  // Missing tabular-nums on numeric table columns
  const NUMERIC_CELL = /^[+\-−$€£¥]?\s*\d[\d,.:/%–-]*\s*(?:%|ms|s|px|km|mi|kg|lb|gb|mb|kb|k|m|b|hrs?|min)?$/i;
  let tabHits = 0;
  for (const table of document.querySelectorAll("table")) {
    if (!isVisible(table) || tabHits >= 4) continue;
    let missing = 0;
    for (const td of table.querySelectorAll("td")) {
      if (!isVisible(td)) continue;
      const txt = (td.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt || txt.length > 24 || !NUMERIC_CELL.test(txt)) continue;
      const cs = getComputedStyle(td);
      const hasTnum = /tabular-nums/i.test(cs.fontVariantNumeric || "") || /["']tnum["'](?!\s*0)/i.test(cs.fontFeatureSettings || "") || isMonoFamily(cs.fontFamily);
      if (!hasTnum) missing++;
    }
    if (missing >= 3) {
      tabHits++;
      add("missing-tabular-nums", describe(table), `${missing} numeric table cells without font-variant-numeric: tabular-nums`, table);
    }
  }

  // Duplicate avatar summary
  for (const [src, entries] of avatarSources) {
    if (entries.length > 1) {
      const shortSrc = src.split("/").slice(-2).join("/");
      add("duplicate-avatar", entries.slice(0, 3).map((e) => e.loc).join(", "), `same avatar "${shortSrc}" appears ${entries.length} times`, entries[0].el);
    }
  }

  // Flat type hierarchy
  if (headingSizes.length && bodySizes.length) {
    bodySizes.sort((a, b) => a - b);
    const medianBody = bodySizes[Math.floor(bodySizes.length / 2)];
    const maxHead = Math.max(...headingSizes);
    if (medianBody > 0 && maxHead / medianBody < 1.2) {
      add("flat-type-hierarchy", "document", `largest heading ${maxHead.toFixed(1)}px vs median body ${medianBody.toFixed(1)}px (${(maxHead / medianBody).toFixed(2)}x < 1.2x)`, document.body);
    }
  }

  // Skipped heading levels
  for (let i = 1; i < headingLevels.length; i++) {
    const prev = headingLevels[i - 1].level;
    const cur = headingLevels[i].level;
    if (cur - prev > 1) {
      add("skipped-heading", describe(headingLevels[i].el), `jumps from h${prev} to h${cur}`, headingLevels[i].el);
    }
  }

  // Missing focus ring in stylesheets (outline: none/0 without visible replacement)
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const r of rules) {
        if (r.type !== 1 || !/:focus(?:-visible)?\b/.test(r.selectorText || "")) continue;
        const txt = r.style?.cssText || "";
        const stripsOutline = /outline(?:-style)?\s*:\s*(?:none|0(?:px)?)\b/i.test(txt);
        const hasReplacement = /box-shadow|border(?:-color)?|background|ring/i.test(txt);
        if (stripsOutline && !hasReplacement) {
          add("missing-focus-ring", r.selectorText.slice(0, 48), `sets outline: none/0 without visible replacement`, document.body);
        }
      }
    }
  } catch {
    // ignore stylesheet inspection errors
  }

  // Rendered design fingerprint (used by `tells same` and `tells pick`)
  const firstFamily = (ff) => {
    if (!ff) return null;
    const raw = ff.split(",")[0].replace(/["']/g, "").trim();
    return raw || null;
  };
  const foldArea = Math.max(1, viewportWidth * window.innerHeight);
  const clipFoldArea = (r) => {
    const x1 = Math.max(0, Math.min(viewportWidth, r.left));
    const y1 = Math.max(0, Math.min(window.innerHeight, r.top));
    const x2 = Math.max(0, Math.min(viewportWidth, r.right));
    const y2 = Math.max(0, Math.min(window.innerHeight, r.bottom));
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  };
  const STATUS_CLASS = /\b(?:ok|warn|warning|err|error|danger|success|positive|negative|alert)\b/i;

  const pageEl = document.querySelector("main") || document.body;
  const rawPage = effectiveBg(pageEl) || effectiveBg(document.body) || [255, 255, 255, 1];
  const fpPage = [Math.round(rawPage[0]), Math.round(rawPage[1]), Math.round(rawPage[2])];
  const pageLum = luminance(fpPage);

  const inkBuckets = new Map();
  const lineBuckets = new Map();
  const bodyFontCounts = new Map();
  const displayFontCounts = new Map();
  const accentBuckets = new Map();
  const nonPillRadii = [];
  let fpPill = false;
  let fpGlass = false;
  let fpGlow = false;
  let fpItalic = false;
  let maxStructuralArea = 0;
  let tintedSurfaceArea = 0;
  let totalChromaticArea = 0;
  let hasSidebar = false;
  let hasTopNav = false;
  let hasSplitPane = false;
  let hasCenteredHero = false;
  let hasCardGrid = false;
  let hasWorkspaceData = false;
  let hasFullBleedStage = false;
  let hasFloatingPanel = false;
  let interactiveCount = 0;

  const addBucket = (map, rgb, weight) => {
    const r = Math.round(rgb[0]);
    const g = Math.round(rgb[1]);
    const b = Math.round(rgb[2]);
    const key = `${Math.round(r / 8) * 8},${Math.round(g / 8) * 8},${Math.round(b / 8) * 8}`;
    const cur = map.get(key) || { w: 0, r: 0, g: 0, b: 0 };
    cur.w += weight;
    cur.r += r * weight;
    cur.g += g * weight;
    cur.b += b * weight;
    map.set(key, cur);
  };
  const topBucket = (map) => {
    let best = null;
    for (const v of map.values()) if (!best || v.w > best.w) best = v;
    return best ? [Math.round(best.r / best.w), Math.round(best.g / best.w), Math.round(best.b / best.w)] : null;
  };
  const recordAccent = (rgb, area) => {
    const h = rgbToHsl(rgb);
    if (h.s < 0.45 || h.l < 0.18 || h.l > 0.78 || colorSpread(rgb) < 28) return;
    const key = Math.round(h.h / 12) * 12;
    const cur = accentBuckets.get(key) || { rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])], h: h.h, s: h.s, l: h.l, area: 0 };
    cur.area += area;
    if (h.s > cur.s) {
      cur.rgb = [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
      cur.h = h.h;
      cur.s = h.s;
      cur.l = h.l;
    }
    accentBuckets.set(key, cur);
  };

  for (const el of all) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fArea = clipFoldArea(rect);
    const clsStr = typeof el.className === "string" ? el.className : "";
    const isStatusEl = STATUS_CLASS.test(`${clsStr} ${el.id || ""}`);

    // Effects
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || "";
    if (/blur\(\s*[1-9]/i.test(bf)) fpGlass = true;
    const flt = cs.filter || "";
    const bm = /blur\(\s*([\d.]+)px\s*\)/i.exec(flt);
    if (bm && parseFloat(bm[1]) >= 40) fpGlow = true;

    // Workspace & structural signals
    if (tag === "table" || tag === "canvas" || tag === "form") hasWorkspaceData = true;
    if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") interactiveCount++;
    if (viewportWidth >= 960) {
      if ((tag === "canvas" || tag === "svg" || tag === "video" || tag === "iframe" || tag === "img" || (cs.backgroundImage && /url\(/i.test(cs.backgroundImage))) && fArea / foldArea >= 0.65) {
        hasFullBleedStage = true;
      }
      if ((cs.position === "fixed" || cs.position === "absolute") && rect.width >= 160 && rect.width < viewportWidth * 0.85 && rect.height >= 40 && (el.textContent || "").trim().length >= 8) {
        hasFloatingPanel = true;
      }
      if ((tag === "aside" || tag === "nav" || el.getAttribute("role") === "navigation" || /sidebar|rail/i.test(`${clsStr} ${el.id || ""}`)) && !el.contains(pageEl)) {
        if (rect.width >= 140 && rect.width <= viewportWidth * 0.36 && rect.height >= Math.min(window.innerHeight * 0.55, 420) && (rect.left <= 48 || rect.right >= viewportWidth - 48)) {
          hasSidebar = true;
        }
      }
      if ((tag === "header" || tag === "nav") && rect.top < 120 && rect.width >= viewportWidth * 0.6 && rect.height <= 120) {
        if (el.querySelectorAll("a, button").length >= 2) hasTopNav = true;
      }
      if (tag === "h1" && rect.top < 500 && parseFloat(cs.fontSize) >= 32) {
        if (cs.textAlign === "center" || Math.abs((rect.left + rect.width / 2) - viewportWidth / 2) <= 80) hasCenteredHero = true;
      }
      // Split-pane: container with 2 side-by-side visible children each 32%-65% vw
      if (!hasSplitPane && el.children.length === 2 && fArea > 0) {
        const [c1, c2] = [...el.children].filter(isVisible);
        if (c1 && c2) {
          const r1 = c1.getBoundingClientRect();
          const r2 = c2.getBoundingClientRect();
          const sideBySide = Math.abs(r1.top - r2.top) <= 48 && Math.abs(r1.right - r2.left) <= 80;
          const bothWide = r1.width >= viewportWidth * 0.32 && r1.width <= viewportWidth * 0.65 && r2.width >= viewportWidth * 0.32 && r2.width <= viewportWidth * 0.65;
          if (sideBySide && bothWide && Math.min(r1.height, r2.height) >= 320) hasSplitPane = true;
        }
      }
    }

    if (tag === "svg") {
      if (!isStatusEl && fArea > 0) {
        for (const shape of el.querySelectorAll("path, rect, circle, polygon, line, polyline")) {
          const scs = getComputedStyle(shape);
          const fill = parseColor(scs.fill);
          const stroke = parseColor(scs.stroke);
          const sa = clipFoldArea(shape.getBoundingClientRect());
          if (fill[3] > 0.2) recordAccent(fill, sa);
          if (stroke[3] > 0.2) recordAccent(stroke, sa * 0.25);
        }
      }
      continue;
    }
    if (el.closest("svg")) continue;

    // Background colour role & accents
    const ownBg = parseColor(cs.backgroundColor);
    if (ownBg[3] > 0.05) {
      const pBg = effectiveBg(el.parentElement) || fpPage;
      const eff = blend(ownBg, pBg);
      const h = rgbToHsl(eff);
      if (!isStatusEl) recordAccent(eff, fArea);
      if (fArea > 0) {
        if (h.s >= 0.4 && h.l >= 0.18 && h.l <= 0.8 && colorSpread(eff) >= 26) totalChromaticArea += fArea;
        if (tag !== "main" && ownBg[3] >= 0.7 && colorDist(eff, fpPage) >= 40) {
          const isChromaticSlab = h.s >= 0.25 && colorSpread(eff) >= 24;
          const isContrastingSlab = rect.width >= viewportWidth * 0.55 && Math.abs(luminance(eff) - pageLum) >= 0.45;
          if ((isChromaticSlab || isContrastingSlab) && fArea > maxStructuralArea) maxStructuralArea = fArea;
        } else if (!NON_CARD_TAG.test(tag) && rect.width < viewportWidth * 0.96 && colorDist(eff, fpPage) >= 10 && colorDist(eff, fpPage) < 80 && h.s < 0.35) {
          tintedSurfaceArea += fArea;
        }
      }
    }

    // Borders / hairlines
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const bw = parseFloat(cs[`border${side}Width`]);
      if (bw >= 0.5 && bw <= 2.5) {
        const bc = parseColor(cs[`border${side}Color`]);
        if (bc[3] > 0.05) {
          const pBg = effectiveBg(el.parentElement) || fpPage;
          const eff = blend(bc, pBg);
          const len = side === "Top" || side === "Bottom" ? rect.width : rect.height;
          if (len >= 24) addBucket(lineBuckets, eff, len);
          if (!isStatusEl && fArea > 0) recordAccent(eff, len * bw);
        }
      }
    }

    // Radii & pills
    const hasSurfaceOrControl =
      ownBg[3] > 0.04 ||
      parseFloat(cs.borderTopWidth) >= 0.5 ||
      tag === "button" || tag === "input" || tag === "select" || tag === "textarea";
    if (hasSurfaceOrControl && rect.width >= 20 && rect.height >= 16) {
      const r = parseFloat(cs.borderTopLeftRadius);
      const isSmallCircle = Math.abs(rect.width - rect.height) <= 4 && r >= rect.width / 2 - 2 && rect.width <= 96;
      if (!isSmallCircle && Number.isFinite(r)) {
        const isPill = rect.width > rect.height + 8 && rect.height <= 56 && r >= rect.height / 2 - 2;
        if (isPill) fpPill = true;
        else if (r < 100 && r < Math.min(rect.width, rect.height) / 2 - 2) nonPillRadii.push(Math.round(r));
      }
    }

    // Direct text: ink, fonts, italic
    let directText = "";
    for (const n of el.childNodes) if (n.nodeType === 3) directText += n.nodeValue;
    directText = directText.replace(/\s+/g, " ").trim();
    if (directText) {
      const fg = parseColor(cs.color);
      const fam = firstFamily(cs.fontFamily);
      if (/^h[1-3]$/.test(tag)) {
        if (fam) displayFontCounts.set(fam, (displayFontCounts.get(fam) || 0) + directText.length);
        if (cs.fontStyle === "italic") fpItalic = true;
      } else {
        if (directText.length >= 6 && !el.closest("a, button")) addBucket(inkBuckets, fg, directText.length);
        if (directText.length >= 12 && fam && (tag === "p" || tag === "li" || tag === "td" || tag === "dd" || tag === "span" || tag === "div")) {
          bodyFontCounts.set(fam, (bodyFontCounts.get(fam) || 0) + directText.length);
        }
        if ((tag === "em" || tag === "i" || cs.fontStyle === "italic") && (el.closest("h1, h2, h3") || /serif/i.test(cs.fontFamily))) {
          fpItalic = true;
        }
      }
      if (!isStatusEl && fArea > 0) recordAccent(fg, fArea * 0.25);
    }
  }

  // Card grid detection in first fold
  if (viewportWidth >= 960 && !hasSidebar && cardEls.size >= 3) {
    const foldCards = [...cardEls.entries()].filter(([, r]) => r.top < 850 && r.width < viewportWidth * 0.45);
    const byTop = [];
    for (const [el, r] of foldCards) {
      const row = byTop.find((g) => Math.abs(g[0].r.top - r.top) <= 24);
      if (row) row.push({ el, r });
      else byTop.push([{ el, r }]);
    }
    if (byTop.some((row) => row.length >= 3 && row.reduce((s, x) => s + clipFoldArea(x.r), 0) / foldArea >= 0.15)) {
      hasCardGrid = true;
    }
  }

  const topFont = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const bodyFont = topFont(bodyFontCounts) ?? firstFamily(getComputedStyle(document.body).fontFamily);
  const displayFont = topFont(displayFontCounts) ?? bodyFont;
  const rawBodyInk = parseColor(getComputedStyle(document.body).color);
  const fpInk = topBucket(inkBuckets) ?? [Math.round(rawBodyInk[0]), Math.round(rawBodyInk[1]), Math.round(rawBodyInk[2])];
  const fpLine = topBucket(lineBuckets);
  const fpAccents = [...accentBuckets.values()]
    .map((a) => ({ rgb: a.rgb, h: Math.round(a.h), s: +a.s.toFixed(2), l: +a.l.toFixed(2), area: +(Math.min(1, a.area / foldArea)).toFixed(4) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 8);

  const colourRole =
    maxStructuralArea / foldArea >= 0.12
      ? "structural-field"
      : totalChromaticArea / foldArea < 0.0015 && fpAccents.length === 0
        ? "monochrome"
        : tintedSurfaceArea / foldArea >= 0.18 && totalChromaticArea / foldArea < 0.05
          ? "tinted-surfaces"
          : "accent-dots";

  const layout =
    viewportWidth < 960
      ? null
      : hasFullBleedStage && hasFloatingPanel
        ? "canvas-overlay"
        : hasSidebar
          ? "sidebar-main"
          : hasSplitPane
            ? "split-pane"
            : hasCenteredHero
              ? "centered-hero"
              : hasCardGrid
                ? "card-grid"
                : hasTopNav && (hasWorkspaceData || interactiveCount >= 5)
                  ? "top-nav-workspace"
                  : "single-column";

  // System traits over the whole page, not just the fold: what `tells consistent` compares across screens.
  const rgbHexIn = (c) => "#" + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, "0")).join("");
  const sysFamilies = {};
  const sysPanels = new Map();
  const sysCharts = { dots: 0, bars: 0, lines: 0, canvas: 0 };
  let sysH1 = null;
  let sysH2 = null;
  for (const el of all) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    if (tag === "svg") {
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 24) {
        const n = (sel) => el.querySelectorAll(sel).length;
        const marks = { dots: n("circle, ellipse"), bars: n("rect"), lines: n("path, polyline, line") };
        const top = Object.entries(marks).sort((a, b) => b[1] - a[1])[0];
        if (top[1] >= 6) sysCharts[top[0]]++;
      }
      continue;
    }
    if (el.closest("svg")) continue;
    if (tag === "canvas") {
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 24) sysCharts.canvas++;
      continue;
    }
    if (tag === "h1" && sysH1 === null) sysH1 = Math.round(parseFloat(cs.fontSize));
    if (tag === "h2" && sysH2 === null) sysH2 = Math.round(parseFloat(cs.fontSize));
    let text = "";
    for (const c of el.childNodes) if (c.nodeType === 3) text += c.nodeValue;
    text = text.replace(/\s+/g, " ").trim();
    if (text) {
      const fam = firstFamily(cs.fontFamily);
      if (fam) sysFamilies[fam] = (sysFamilies[fam] || 0) + text.length;
    }
    if (tag !== "main" && tag !== "body" && tag !== "html") {
      const r = el.getBoundingClientRect();
      const bg = parseColor(cs.backgroundColor);
      const bw = parseFloat(cs.borderTopWidth);
      const hasBorder = bw >= 0.5 && parseColor(cs.borderTopColor)[3] > 0.05;
      if (r.width >= 240 && r.height >= 120 && (bg[3] > 0.04 || hasBorder)) {
        const key = `${Math.round(parseFloat(cs.borderTopLeftRadius))}|${bg[3] > 0.04 ? rgbHexIn(blend(bg, fpPage.concat(1))) : "none"}|${hasBorder ? rgbHexIn(blend(parseColor(cs.borderTopColor), fpPage.concat(1))) : "none"}`;
        sysPanels.set(key, (sysPanels.get(key) || 0) + r.width * r.height);
      }
    }
  }
  const topPanel = [...sysPanels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split("|") ?? null;
  const system = {
    families: sysFamilies,
    h1: sysH1,
    h2: sysH2,
    charts: sysCharts,
    panel: topPanel ? { radius: Number(topPanel[0]), bg: topPanel[1], border: topPanel[2] } : null,
  };

  const fingerprint = {
    system,
    page: fpPage,
    ink: fpInk,
    line: fpLine,
    accents: fpAccents,
    bodyFont,
    displayFont,
    radius: nonPillRadii.length ? Math.max(...nonPillRadii) : null,
    pill: fpPill,
    glass: fpGlass,
    glow: fpGlow,
    italic: fpItalic,
    colourRole,
    layout,
    ok: docDirectives,
  };

  return { findings, allowed, fingerprint };
}

// ---------------------------------------------------------------------------
// Runner

async function auditTarget(browser, url, label, widths, onlyRule, theme = "light") {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const hits = [];
  const allowed = [];
  let fingerprint = null;
  let fingerprintWidth = 0;
  let squashDone = false;

  try {
    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Runtime.enable", {}, sessionId);
    await emulateTheme(browser, sessionId, theme);

    for (const width of widths) {
      await browser.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: width <= 480 },
        sessionId
      );

      await navigate(browser, sessionId, url);

      // Wait briefly for web fonts & layout settle
      await browser.send("Runtime.evaluate", { expression: SETTLE_EXPR, awaitPromise: true }, sessionId);

      const evalRes = await browser.send(
        "Runtime.evaluate",
        {
          expression: `(${inPageAudit.toString()})(${width})`,
          returnByValue: true,
        },
        sessionId
      );

      if (evalRes.exceptionDetails) {
        throw new Error(evalRes.exceptionDetails.text || "Evaluation failed");
      }

      const payload = evalRes.result?.value || { findings: [], allowed: [], fingerprint: null };
      // squashed-block: once, at the first desktop width, on the page as loaded. Tall window, then short.
      if (width >= 960 && !squashDone && (!onlyRule || onlyRule === "squashed-block")) {
        squashDone = true;
        for (const [height, mode] of [[SQUASH_TALL, "squash-mark"], [SQUASH_SHORT, "squash-check"]]) {
          await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
          await browser.send("Runtime.evaluate", { expression: SETTLE_EXPR, awaitPromise: true }, sessionId);
          const res = await browser.send("Runtime.evaluate", { expression: `(${inPageAudit.toString()})(${width}, "${mode}")`, returnByValue: true }, sessionId);
          if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "Evaluation failed");
          payload.findings.push(...(res.result?.value?.findings || []));
          payload.allowed = [...(payload.allowed || []), ...(res.result?.value?.allowed || [])];
        }
      }
      if (payload.fingerprint && width >= fingerprintWidth) {
        fingerprint = { target: label, width, ...payload.fingerprint };
        fingerprintWidth = width;
      }
      for (const item of payload.findings || []) {
        if (onlyRule && item.rule !== onlyRule) continue;
        const rule = RULE_BY_ID.get(item.rule);
        if (!rule) continue;
        hits.push({
          target: label,
          width,
          rule: item.rule,
          severity: rule.severity,
          category: rule.category,
          where: item.where,
          detail: item.detail,
          fix: rule.fix,
        });
      }
      for (const item of payload.allowed || []) {
        if (onlyRule && item.rule !== onlyRule) continue;
        const rule = RULE_BY_ID.get(item.rule);
        if (!rule) continue;
        allowed.push({
          target: label,
          width,
          rule: item.rule,
          severity: rule.severity,
          category: rule.category,
          where: item.where,
          detail: item.detail,
          reason: item.reason,
        });
      }
    }
  } catch (err) {
    throw new Error(err.message.includes(url) ? err.message : `${label}: ${err.message}`);
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
  }

  return { hits, allowed, fingerprint };
}

/** Fingerprint a batch of HTML files or URLs in one headless Chrome session (used by `tells same`). */
export async function fingerprintPages(targets, { width = 1440, theme = "light" } = {}) {
  const out = new Map();
  if (!targets.length) return out;
  const files = targets.filter((t) => t.kind === "file").map((t) => t.file);
  const serveRoot = files.length ? serveRootFor(files, ROOT) : null;
  const srv = files.length ? await startServer(serveRoot) : null;
  const browser = new CdpBrowser(findChrome());
  browser.start();
  try {
    await browser.ready();
    for (const t of targets) {
      const url = t.kind === "url" ? t.url : fileToUrl(srv.baseUrl, serveRoot, t.file) + (t.hash ?? "");
      const { fingerprint } = await auditTarget(browser, url, t.label ?? t.id, [width], null, theme);
      if (fingerprint) out.set(t.id, fingerprint);
    }
  } finally {
    await browser.close();
    if (srv) srv.server.close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporting (mirrors src/check.mjs)

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: wrap("31"), yellow: wrap("33"), green: wrap("32"), dim: wrap("2"), bold: wrap("1"), cyan: wrap("36") };
}

function dedupeHits(rawHits) {
  const map = new Map();
  for (const h of rawHits) {
    const key = `${h.target}\0${h.rule}\0${h.where}\0${h.detail}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.widths.includes(h.width)) existing.widths.push(h.width);
    } else {
      const entry = {
        target: h.target,
        widths: [h.width],
        rule: h.rule,
        severity: h.severity,
        category: h.category,
        where: h.where,
        detail: h.detail,
      };
      if (h.fix !== undefined) entry.fix = h.fix;
      if (h.reason !== undefined) entry.reason = h.reason;
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

function formatWidths(widths, allWidths) {
  if (allWidths.length > 1 && widths.length === allWidths.length) return "all";
  return widths.map((w) => `${w}`).join("/");
}

function printReport({ targets, hits, allowed = [] }, paint) {
  const out = [];
  const widthsByTarget = new Map(targets.map((t) => [t.label, t.widths]));
  const byTarget = new Map();
  for (const h of hits) {
    if (!byTarget.has(h.target)) byTarget.set(h.target, []);
    byTarget.get(h.target).push(h);
  }
  const idWidth = Math.max(...RULES.map((r) => r.id.length));

  for (const [target, list] of byTarget) {
    const errors = list.filter((h) => h.severity === "error").length;
    const allW = widthsByTarget.get(target) || [];
    out.push(paint.bold(target) + paint.dim(`  ${errors} error, ${list.length - errors} warn`));
    const wCol = Math.max(4, ...list.map((h) => formatWidths(h.widths, allW).length));
    for (const h of list) {
      const w = formatWidths(h.widths, allW).padStart(wCol);
      const sev = h.severity === "error" ? paint.red("[error]") : paint.yellow("[warn] ");
      out.push(`  ${paint.dim(w)}  ${sev} ${h.rule.padEnd(idWidth)}  ${h.where} — ${h.detail}`);
    }
    out.push("");
  }

  if (allowed.length) {
    out.push(paint.bold("Allowed") + paint.dim(`  ${allowed.length} justified exception${allowed.length === 1 ? "" : "s"}`));
    for (const a of allowed) {
      out.push(`  ${paint.dim(a.target)}  ${paint.green("[ok]   ")} ${a.rule.padEnd(idWidth)}  ${a.reason}`);
    }
    out.push("");
  }

  const hitRules = [...new Set(hits.map((h) => h.rule))].sort();
  if (hitRules.length) {
    out.push(paint.bold("Fixes"));
    for (const id of hitRules) out.push(`  ${paint.cyan(id.padEnd(idWidth))}  ${RULE_BY_ID.get(id).fix}`);
    out.push("");
  }

  out.push(paint.bold("Summary") + paint.dim(`  ${targets.length} page${targets.length === 1 ? "" : "s"} audited`));
  out.push(`  ${"category".padEnd(12)}${"error".padStart(7)}${"warn".padStart(7)}${"allowed".padStart(9)}`);
  const row = (name, e, w, a) => `  ${name.padEnd(12)}${String(e).padStart(7)}${String(w).padStart(7)}${String(a).padStart(9)}`;
  let te = 0;
  let tw = 0;
  let ta = 0;
  for (const cat of CATEGORIES) {
    const e = hits.filter((h) => h.category === cat && h.severity === "error").length;
    const w = hits.filter((h) => h.category === cat && h.severity === "warn").length;
    const a = allowed.filter((x) => x.category === cat).length;
    te += e;
    tw += w;
    ta += a;
    const line = row(cat, e, w, a);
    out.push(e || w || a ? line : paint.dim(line));
  }
  out.push(`  ${"-".repeat(35)}`);
  out.push(paint.bold(row("total", te, tw, ta)));
  if (!hits.length) out.push(paint.green("\n  Clean."));
  console.log(out.join("\n"));
}

function summarize(hits, allowed = []) {
  const byCategory = {};
  for (const cat of CATEGORIES) {
    byCategory[cat] = {
      error: hits.filter((h) => h.category === cat && h.severity === "error").length,
      warn: hits.filter((h) => h.category === cat && h.severity === "warn").length,
      allowed: allowed.filter((a) => a.category === cat).length,
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

export async function run(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);

  if (flags.rules) {
    for (const r of RULES) console.log(`${r.id.padEnd(21)} ${r.severity.padEnd(6)} ${r.category.padEnd(10)} ${r.fix}`);
    return;
  }

  const onlyRule = typeof flags.rule === "string" ? flags.rule : null;
  if (flags.rule && (!onlyRule || !RULE_BY_ID.has(onlyRule))) {
    throw new Error(`unknown rule "${onlyRule ?? ""}". Known: ${RULES.map((r) => r.id).join(", ")}`);
  }

  const theme = themeOf(flags);
  const explicitWidths = flags.widths ? parseWidths(flags.widths) : null;

  const rawInputs = positional.length ? positional : DEFAULT_PATHS;
  const targets = [];
  let needsServer = false;

  for (const inp of rawInputs) {
    if (/^https?:\/\//i.test(inp)) {
      // A URL has no folder of its own: the .tellsrc of where render runs says what it's for.
      targets.push({ kind: "url", url: inp, label: inp, widths: explicitWidths || configFor(path.join(ROOT, ".tellsrc"))?.config.widths || DEFAULT_WIDTHS });
    } else {
      // index.html#/inbox: one route of a single-page app, audited as its own page
      const { file, hash } = splitRoute(inp);
      const files = [];
      walkHtml(path.resolve(ROOT, file), files);
      for (const f of hash ? files.slice(0, 1) : files) {
        needsServer = true;
        const rel = display(f) + hash;
        const isMobileOnly = /(?:^|[\\/])(?:mobile|m\d+-)/i.test(rel);
        targets.push({
          kind: "file",
          file: f,
          hash,
          label: rel,
          // --widths, else the widths its .tellsrc says the product is for, else the defaults
          widths: explicitWidths || configFor(f)?.config.widths || (isMobileOnly ? [390] : DEFAULT_WIDTHS),
        });
      }
    }
  }

  if (!targets.length) {
    throw new Error(
      `no HTML pages in ${rawInputs.join(", ")}. render loads .html files and http(s) URLs: build the app first, or point it at a dev server (tells render http://localhost:3000).`
    );
  }

  const chromePath = findChrome();
  const serveRoot = needsServer ? serveRootFor(targets.filter((t) => t.kind === "file").map((t) => t.file)) : null;
  const srv = needsServer ? await startServer(serveRoot) : null;
  const browser = new CdpBrowser(chromePath);
  browser.start();

  const cleanup = async () => {
    await browser.close();
    if (srv) srv.server.close();
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  const rawHits = [];
  const rawAllowed = [];
  const fingerprints = [];
  try {
    await browser.ready();
    for (const t of targets) {
      const url = t.kind === "url" ? t.url : fileToUrl(srv.baseUrl, serveRoot, t.file) + (t.hash ?? "");
      const found = await auditTarget(browser, url, t.label, t.widths, onlyRule, theme);
      // .tellsrc "allow": project-wide exceptions, still reported as allowed
      const allow = t.kind === "file" ? configFor(t.file)?.config.allow ?? {} : {};
      for (const h of found.hits) {
        if (allow[h.rule]) {
          const { fix, ...rest } = h;
          rawAllowed.push({ ...rest, reason: `.tellsrc: ${allow[h.rule]}` });
        } else rawHits.push(h);
      }
      rawAllowed.push(...found.allowed);
      if (found.fingerprint) fingerprints.push(found.fingerprint);
    }
  } finally {
    await cleanup();
  }

  const hits = dedupeHits(rawHits);
  const allowed = dedupeHits(rawAllowed);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          targets: targets.map((t) => ({ target: t.label, widths: t.widths })),
          rule: onlyRule,
          hits,
          allowed,
          fingerprints,
          summary: summarize(hits, allowed),
        },
        null,
        2
      )
    );
  } else {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    printReport({ targets, hits, allowed }, makePaint(color));
  }

  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}

export { RULES, findChrome };
