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
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const DEFAULT_PATHS = ["."];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out", "coverage", "vendor", "shots", "_assets"]);
const DEFAULT_WIDTHS = [1440, 960, 390];
const VIEWPORT_HEIGHT = 900;
const CATEGORIES = ["layout", "color", "type", "mobile", "surfaces", "media", "a11y"];

const RULES = [
  { id: "horizontal-overflow", category: "layout", severity: "error", fix: "Eliminate horizontal overflow (scrollWidth > viewport width) at every tested width." },
  { id: "clipped-text", category: "layout", severity: "warn", fix: "Prevent text clipping or descender cut-off inside overflow:hidden containers (check wrapping, width, and line-height)." },
  { id: "cramped-padding", category: "layout", severity: "warn", fix: "Give bordered/surface containers at least 8px padding on non-zero sides." },
  { id: "tall-top-nav", category: "layout", severity: "warn", fix: "Keep desktop top navigation on a single line and <= 80px tall." },
  { id: "low-contrast", category: "color", severity: "error", fix: "Meet WCAG AA contrast: >= 4.5:1 for normal text, >= 3:1 for large text (>= 24px or >= 18.66px bold)." },
  { id: "tiny-text", category: "type", severity: "warn", fix: "Keep readable text >= 12px at mobile widths (and never < 10px anywhere)." },
  { id: "long-measure", category: "type", severity: "warn", fix: "Constrain multi-line prose blocks to <= 80ch for readability." },
  { id: "flat-type-hierarchy", category: "type", severity: "warn", fix: "Establish clear type hierarchy: largest heading should be >= 1.2x body font size." },
  { id: "small-tap-target", category: "mobile", severity: "warn", fix: "Make mobile interactive controls at least 44x44px (or expand their hit area)." },
  { id: "concentric-radius", category: "surfaces", severity: "warn", fix: "Match concentric radii on tightly inset surfaces (outerRadius = innerRadius + padding + borderWidth)." },
  { id: "broken-image", category: "media", severity: "error", fix: "Fix broken image asset (naturalWidth === 0)." },
  { id: "duplicate-avatar", category: "media", severity: "error", fix: "Never reuse the same portrait/avatar image for two different people or duplicate the signed-in user avatar." },
  { id: "skipped-heading", category: "a11y", severity: "warn", fix: "Do not skip heading levels (e.g. h1 -> h3); step down sequentially." },
  { id: "missing-focus-ring", category: "a11y", severity: "warn", fix: "Never set outline: none/0 on :focus without a visible replacement (box-shadow, border-color, or :focus-visible ring)." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

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
      else if ((k === "rule" || k === "widths") && argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
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

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Could not find Chrome/Chromium binary. Set CHROME_PATH=/path/to/chrome.");
}

// ---------------------------------------------------------------------------
// Static file server for local HTML files

function startServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
        const full = path.resolve(rootDir, "." + reqPath);
        if (!full.startsWith(rootDir)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const stat = fs.statSync(full);
        const filePath = stat.isDirectory() ? path.join(full, "index.html") : full;
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal zero-dependency CDP client over --remote-debugging-pipe (FD 3 / FD 4)

class CdpBrowser {
  constructor(chromePath) {
    this.chromePath = chromePath;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.buf = Buffer.alloc(0);
  }

  start() {
    this.proc = spawn(
      this.chromePath,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--metrics-recording-only",
        "--mute-audio",
        "--hide-scrollbars",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] }
    );
    this.tx = this.proc.stdio[3];
    this.rx = this.proc.stdio[4];
    this.rx.on("data", (chunk) => this._onData(chunk));
    this.proc.on("exit", (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`Chrome exited unexpectedly (code ${code})`));
      }
      this.pending.clear();
    });
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let idx;
    while ((idx = this.buf.indexOf(0)) !== -1) {
      const raw = this.buf.subarray(0, idx).toString("utf8");
      this.buf = this.buf.subarray(idx + 1);
      if (!raw) continue;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        const key = `${msg.sessionId || ""}:${msg.method}`;
        const set = this.listeners.get(key);
        if (set) {
          for (const fn of [...set]) fn(msg.params);
        }
      }
    }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout on ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.tx.write(JSON.stringify(payload) + "\0");
    });
  }

  onceEvent(method, sessionId = "", timeoutMs = 15000) {
    const key = `${sessionId}:${method}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.get(key)?.delete(handler);
        reject(new Error(`CDP event timeout on ${method}`));
      }, timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        this.listeners.get(key)?.delete(handler);
        resolve(params);
      };
      if (!this.listeners.has(key)) this.listeners.set(key, new Set());
      this.listeners.get(key).add(handler);
    });
  }

  async close() {
    if (!this.proc) return;
    try {
      await this.send("Browser.close", {}, undefined, 2000).catch(() => {});
    } finally {
      if (!this.proc.killed) this.proc.kill("SIGKILL");
      this.proc = null;
    }
  }
}

// ---------------------------------------------------------------------------
// In-page audit payload (executed via Runtime.evaluate)

function inPageAudit(viewportWidth) {
  const findings = [];
  const add = (rule, where, detail) => findings.push({ rule, where, detail });

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
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
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

  // 1. Horizontal overflow
  const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
  if (docOverflow > 1) {
    add("horizontal-overflow", "document", `scrollWidth ${document.documentElement.scrollWidth}px > viewport ${window.innerWidth}px (+${Math.round(docOverflow)}px)`);
  }

  const all = [...document.querySelectorAll("body *")];
  const measureCanvas = document.createElement("canvas").getContext("2d");

  // 2. Contrast, tiny text, clipped text, long measure, cramped padding
  const bodySizes = [];
  const headingSizes = [];
  const headingLevels = [];
  const seenLowContrast = new Set();
  const seenTiny = new Set();
  const seenClipped = new Set();
  const seenTap = new Set();
  const seenCramped = new Set();
  const seenConcentric = new Set();
  const avatarSources = new Map();

  for (const el of all) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg" || el.closest("svg")) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

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
          add("tiny-text", describe(el), `${fs.toFixed(1)}px (< ${minFs}px at ${viewportWidth}px)`);
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
              add("low-contrast", describe(el), `contrast ${ratio.toFixed(2)}:1 (needs >= ${req}:1, ${fs.toFixed(0)}px)`);
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
          add("clipped-text", describe(el), `text clipped on ${axis}`);
        }
      }
    }

    // Heading sequence tracking
    if (/^h[1-6]$/.test(tag)) {
      headingLevels.push({ level: Number(tag[1]), el });
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
          add("long-measure", describe(el), `~${Math.round(chars)}ch wide (limit 80ch)`);
        }
      }
    }

    // Mobile tap targets (< 44x44)
    if (viewportWidth <= 480 && el.matches('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]')) {
      const inProse = tag === "a" && Boolean(el.closest("p, li, dd, blockquote"));
      if (!inProse && (rect.width < 43.5 || rect.height < 43.5)) {
        const key = `${tag}.${el.className}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
        if (!seenTap.has(key) && seenTap.size < 10) {
          seenTap.add(key);
          add("small-tap-target", describe(el), `${Math.round(rect.width)}x${Math.round(rect.height)}px (< 44x44px)`);
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
            add("cramped-padding", describe(el), `min non-zero padding ${minP.toFixed(0)}px (< 8px)`);
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
          if (rInner >= 2 && !isChildPill && childHasSurface) {
            const expected = rInner + pt + bw;
            if (Math.abs(rOuter - expected) > 2.5) {
              const key = `${Math.round(rOuter)}/${Math.round(rInner)}/${Math.round(pt)}`;
              if (!seenConcentric.has(key) && seenConcentric.size < 6) {
                seenConcentric.add(key);
                add("concentric-radius", `${describe(el)} > ${describe(child)}`, `outer ${rOuter}px vs inner ${rInner}px + pad ${pt}px (expected ~${Math.round(expected)}px)`);
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
        add("broken-image", describe(el), `broken src="${el.getAttribute("src") || ""}"`);
      } else {
        const src = el.currentSrc || el.getAttribute("src") || "";
        const aspect = rect.width / Math.max(1, rect.height);
        const looksLikeAvatar =
          /people|avatar|portrait|face|headshot|user/i.test(`${src} ${el.className} ${el.alt}`) ||
          (rect.width <= 96 && rect.height <= 96 && aspect >= 0.8 && aspect <= 1.25 && parseFloat(cs.borderTopLeftRadius) >= rect.width * 0.25);
        if (looksLikeAvatar && src) {
          if (!avatarSources.has(src)) avatarSources.set(src, []);
          avatarSources.get(src).push(describe(el));
        }
      }
    }

    // Desktop top nav height <= 80px and single line
    if (viewportWidth >= 960 && (tag === "header" || tag === "nav") && rect.top < 120 && rect.width >= viewportWidth * 0.6) {
      if (rect.height > 82) {
        add("tall-top-nav", describe(el), `top nav height ${Math.round(rect.height)}px (> 80px)`);
      } else {
        const navLinks = [...el.querySelectorAll("a, button")].filter(isVisible);
        if (navLinks.length >= 3) {
          const tops = navLinks.map((n) => Math.round(n.getBoundingClientRect().top));
          if (Math.max(...tops) - Math.min(...tops) > 20) {
            add("tall-top-nav", describe(el), `top nav items wrap onto multiple lines (vertical spread ${Math.max(...tops) - Math.min(...tops)}px)`);
          }
        }
      }
    }
  }

  // Duplicate avatar summary
  for (const [src, locs] of avatarSources) {
    if (locs.length > 1) {
      const shortSrc = src.split("/").slice(-2).join("/");
      add("duplicate-avatar", locs.slice(0, 3).join(", "), `same avatar "${shortSrc}" appears ${locs.length} times`);
    }
  }

  // Flat type hierarchy
  if (headingSizes.length && bodySizes.length) {
    bodySizes.sort((a, b) => a - b);
    const medianBody = bodySizes[Math.floor(bodySizes.length / 2)];
    const maxHead = Math.max(...headingSizes);
    if (medianBody > 0 && maxHead / medianBody < 1.2) {
      add("flat-type-hierarchy", "document", `largest heading ${maxHead.toFixed(1)}px vs median body ${medianBody.toFixed(1)}px (${(maxHead / medianBody).toFixed(2)}x < 1.2x)`);
    }
  }

  // Skipped heading levels
  for (let i = 1; i < headingLevels.length; i++) {
    const prev = headingLevels[i - 1].level;
    const cur = headingLevels[i].level;
    if (cur - prev > 1) {
      add("skipped-heading", describe(headingLevels[i].el), `jumps from h${prev} to h${cur}`);
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
          add("missing-focus-ring", r.selectorText.slice(0, 48), `sets outline: none/0 without visible replacement`);
        }
      }
    }
  } catch {
    // ignore stylesheet inspection errors
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Runner

async function auditTarget(browser, url, label, widths, onlyRule) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const hits = [];

  try {
    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Runtime.enable", {}, sessionId);

    for (const width of widths) {
      await browser.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: width <= 480 },
        sessionId
      );

      const loaded = browser.onceEvent("Page.loadEventFired", sessionId, 15000);
      await browser.send("Page.navigate", { url }, sessionId);
      await loaded;

      // Wait briefly for web fonts & layout settle
      await browser.send(
        "Runtime.evaluate",
        {
          expression: "(async () => { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()",
          awaitPromise: true,
        },
        sessionId
      );

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

      const items = evalRes.result?.value || [];
      for (const item of items) {
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
    }
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
  }

  return hits;
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
      map.set(key, {
        target: h.target,
        widths: [h.width],
        rule: h.rule,
        severity: h.severity,
        category: h.category,
        where: h.where,
        detail: h.detail,
        fix: h.fix,
      });
    }
  }
  return [...map.values()];
}

function formatWidths(widths, allWidths) {
  if (allWidths.length > 1 && widths.length === allWidths.length) return "all";
  return widths.map((w) => `${w}`).join("/");
}

function printReport({ targets, hits }, paint) {
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

  const hitRules = [...new Set(hits.map((h) => h.rule))].sort();
  if (hitRules.length) {
    out.push(paint.bold("Fixes"));
    for (const id of hitRules) out.push(`  ${paint.cyan(id.padEnd(idWidth))}  ${RULE_BY_ID.get(id).fix}`);
    out.push("");
  }

  out.push(paint.bold("Summary") + paint.dim(`  ${targets.length} page${targets.length === 1 ? "" : "s"} audited`));
  out.push(`  ${"category".padEnd(12)}${"error".padStart(7)}${"warn".padStart(7)}`);
  const row = (name, e, w) => `  ${name.padEnd(12)}${String(e).padStart(7)}${String(w).padStart(7)}`;
  let te = 0;
  let tw = 0;
  for (const cat of CATEGORIES) {
    const e = hits.filter((h) => h.category === cat && h.severity === "error").length;
    const w = hits.filter((h) => h.category === cat && h.severity === "warn").length;
    te += e;
    tw += w;
    const line = row(cat, e, w);
    out.push(e || w ? line : paint.dim(line));
  }
  out.push(`  ${"-".repeat(26)}`);
  out.push(paint.bold(row("total", te, tw)));
  if (!hits.length) out.push(paint.green("\n  Clean."));
  console.log(out.join("\n"));
}

function summarize(hits) {
  const byCategory = {};
  for (const cat of CATEGORIES) {
    byCategory[cat] = {
      error: hits.filter((h) => h.category === cat && h.severity === "error").length,
      warn: hits.filter((h) => h.category === cat && h.severity === "warn").length,
    };
  }
  const byRule = {};
  for (const h of hits) byRule[h.rule] = (byRule[h.rule] || 0) + 1;
  return {
    byCategory,
    byRule,
    errors: hits.filter((h) => h.severity === "error").length,
    warnings: hits.filter((h) => h.severity === "warn").length,
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
    console.error(`Error: unknown rule "${onlyRule ?? ""}". Known: ${RULES.map((r) => r.id).join(", ")}`);
    process.exit(2);
  }

  const explicitWidths = flags.widths
    ? String(flags.widths)
        .split(",")
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 240)
    : null;

  const rawInputs = positional.length ? positional : DEFAULT_PATHS;
  const targets = [];
  let needsServer = false;

  for (const inp of rawInputs) {
    if (/^https?:\/\//i.test(inp)) {
      targets.push({ kind: "url", url: inp, label: inp, widths: explicitWidths || DEFAULT_WIDTHS });
    } else {
      const files = [];
      walkHtml(path.resolve(ROOT, inp), files);
      for (const f of files) {
        needsServer = true;
        const rel = display(f);
        const isMobileOnly = /(?:^|\/)(?:mobile|m\d+-)/i.test(rel);
        targets.push({
          kind: "file",
          file: f,
          label: rel,
          widths: explicitWidths || (isMobileOnly ? [390] : DEFAULT_WIDTHS),
        });
      }
    }
  }

  if (!targets.length) {
    console.error("tells render: no HTML files or URLs found.");
    process.exit(1);
  }

  const chromePath = findChrome();
  const serveRoot = needsServer ? commonDir(targets.filter((t) => t.kind === "file").map((t) => t.file)) : null;
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
  try {
    for (const t of targets) {
      const url = t.kind === "url" ? t.url : `${srv.baseUrl}/${path.relative(serveRoot, t.file).split(path.sep).map(encodeURIComponent).join("/")}`;
      const found = await auditTarget(browser, url, t.label, t.widths, onlyRule);
      rawHits.push(...found);
    }
  } finally {
    await cleanup();
  }

  const hits = dedupeHits(rawHits);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          targets: targets.map((t) => ({ target: t.label, widths: t.widths })),
          rule: onlyRule,
          hits,
          summary: summarize(hits),
        },
        null,
        2
      )
    );
  } else {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    printReport({ targets, hits }, makePaint(color));
  }

  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}

// Serve from the deepest folder that holds every target, so paths outside the cwd still load.
function commonDir(files) {
  const parts = files.map((f) => path.dirname(f).split(path.sep));
  const first = parts[0];
  let n = first.length;
  for (const p of parts) {
    let i = 0;
    while (i < n && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join(path.sep) || path.sep;
}

export { RULES };
