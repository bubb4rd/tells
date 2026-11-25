/**
 * tells measure: a continuous profile of a rendered screen, not pass/fail.
 *
 * Usage:
 *   tells measure [files|dirs|urls...] [--width 1440] [--shots <dir>] [--full] [--json]
 *
 * Each dimension comes from something that held up in the picks (playbook/taste.md):
 *   lead       what the heaviest type on the first screen is: a number, a name or a sentence
 *   ui share   how much of the first screen is ink (text, media, controls), and how much sits near it
 *   restraint  how many font sizes, weights, colours, radii and spacings the page uses
 *   alignment  how many text blocks share a left edge with another block
 *   hierarchy  lead size over body size, and how many size levels the first screen shows
 * Nothing here is a rule. The numbers are meant to be read against shipped work of the same kind.
 */
import fs from "node:fs";
import path from "node:path";
import { CdpBrowser, findChrome, startServer, serveRootFor, fileToUrl, SETTLE_EXPR, emulateTheme, themeOf } from "./cdp.mjs";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "shots", "_assets"]);

function inPageMeasure() {
  const VW = innerWidth;
  const VH = innerHeight;
  const SCOPE = VH * 2; // restraint and alignment read the first two screens

  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgbCache = new Map();
  const rgb = (c) => {
    if (rgbCache.has(c)) return rgbCache.get(c);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = { r, g, b, a: a / 255 };
    rgbCache.set(c, out);
    return out;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const bgOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor);
      if (c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const scrollY = window.scrollY;

  // Text blocks: one per element that directly holds text.
  const blocks = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    const top = Math.min(...rects.map((r) => r.top)) + scrollY;
    if (top > SCOPE) continue;
    let b = blocks.get(el);
    if (!b) {
      if (!shown(el)) continue;
      const cs = getComputedStyle(el);
      b = {
        el,
        text: "",
        rects: [],
        size: Math.round(parseFloat(cs.fontSize)),
        weight: parseInt(cs.fontWeight, 10) || 400,
        family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase(),
        color: rgb(cs.color),
        align: cs.textAlign,
      };
      blocks.set(el, b);
    }
    b.text += (b.text ? " " : "") + text;
    b.rects.push(...rects.map((r) => ({ left: r.left, top: r.top + scrollY, right: r.right, bottom: r.bottom + scrollY })));
  }
  const all = [...blocks.values()].filter((b) => b.size >= 6);
  for (const b of all) {
    b.left = Math.min(...b.rects.map((r) => r.left));
    b.top = Math.min(...b.rects.map((r) => r.top));
    b.right = Math.max(...b.rects.map((r) => r.right));
    b.bottom = Math.max(...b.rects.map((r) => r.bottom));
    b.chars = b.text.replace(/\s/g, "").length;
    b.contrast = contrast(b.color, bgOf(b.el));
  }
  const fold = all.filter((b) => b.top < VH && b.bottom > 0);

  // Media and controls.
  const media = [];
  const controls = [];
  for (const el of document.body.querySelectorAll("img, svg, canvas, video, picture, iframe, input, select, textarea, button, [role=button]")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= VH || r.right <= 0 || r.left >= VW) continue;
    if (!shown(el)) continue;
    const box = { left: r.left, top: r.top + scrollY, right: r.right, bottom: r.bottom + scrollY };
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) || el.getAttribute("role") === "button") controls.push(box);
    else media.push({ ...box, area: r.width * r.height, tag: el.tagName.toLowerCase() });
  }

  // Ink on an 8px grid over the first screen.
  const CELL = 8;
  const cols = Math.ceil(VW / CELL);
  const rows = Math.ceil(VH / CELL);
  const grid = new Uint8Array(cols * rows);
  const paint = (r) => {
    const x0 = Math.max(0, Math.floor(r.left / CELL));
    const x1 = Math.min(cols - 1, Math.floor((r.right - 1) / CELL));
    const y0 = Math.max(0, Math.floor((r.top - scrollY) / CELL));
    const y1 = Math.min(rows - 1, Math.floor((r.bottom - scrollY - 1) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 1;
  };
  for (const b of fold) for (const r of b.rects) paint(r);
  for (const m of media) paint(m);
  for (const c of controls) paint(c);
  let ink = 0;
  for (const v of grid) ink += v;
  const R = 4; // 32px reach
  let reach = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let hit = 0;
      for (let dy = -R; dy <= R && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < cols && grid[yy * cols + xx]) {
            hit = 1;
            break;
          }
        }
      }
      reach += hit;
    }
  }
  const mediaShare = Math.min(1, media.reduce((s, m) => s + Math.max(0, Math.min(m.bottom - scrollY, VH) - Math.max(m.top - scrollY, 0)) * Math.max(0, Math.min(m.right, VW) - Math.max(m.left, 0)), 0) / (VW * VH));

  // Lead: the heaviest type on the first screen. Size dominates, then weight and contrast.
  const kindOf = (t) => {
    const s = t.trim();
    if (/^[+\-−]?[$€£¥]?\s?\d[\d.,:]*\s?(%|°[CF]?|[kKmMbB]|[a-z]{1,3})?$/.test(s)) return "number";
    if (s.split(/\s+/).length >= 4) return "sentence";
    return "name";
  };
  const weightOf = (b) => b.size ** 2 * Math.sqrt(b.weight / 400) * Math.min(1, b.contrast / 4.5);
  const leadBlock = fold.filter((b) => /[\p{L}\p{N}]/u.test(b.text)).sort((a, b) => weightOf(b) - weightOf(a))[0] || null;

  // Body: the size that carries the most characters.
  const charsBy = (key, list) => {
    const m = new Map();
    for (const b of list) m.set(key(b), (m.get(key(b)) || 0) + b.chars);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const total = all.reduce((s, b) => s + b.chars, 0) || 1;
  const cover = (entries, share = 0.9) => {
    let acc = 0;
    let n = 0;
    for (const [, c] of entries) {
      if (acc / total >= share) break;
      acc += c;
      n++;
    }
    return n;
  };
  const sizes = charsBy((b) => b.size, all);
  const body = sizes[0]?.[0] ?? 16;
  const colourKey = (b) => `${b.color.r >> 4},${b.color.g >> 4},${b.color.b >> 4}`;

  // Boxes: radii and spacing in the first two screens.
  const radii = new Set();
  const spacings = new Map();
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.top + scrollY > SCOPE || r.bottom + scrollY < 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const painted = rgb(cs.backgroundColor).a > 0.1 || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
    const rad = Math.round(parseFloat(cs.borderTopLeftRadius));
    if (painted && rad > 0 && rad < Math.min(r.width, r.height) / 2 - 1) radii.add(rad);
    for (const p of ["paddingTop", "paddingLeft", "marginTop", "marginBottom", "rowGap", "columnGap"]) {
      const v = Math.round(parseFloat(cs[p]));
      if (v > 0 && v < 400) spacings.set(v, (spacings.get(v) || 0) + 1);
    }
  }
  const spacingTotal = [...spacings.values()].reduce((s, n) => s + n, 0) || 1;
  const onGrid = [...spacings.entries()].filter(([v]) => v % 4 === 0).reduce((s, [, n]) => s + n, 0) / spacingTotal;

  // Alignment: text blocks whose left edge another block shares (within 1px).
  const lefts = all.filter((b) => b.chars >= 2 && b.align !== "center").map((b) => Math.round(b.left));
  const leftCount = new Map();
  for (const l of lefts) leftCount.set(l, (leftCount.get(l) || 0) + 1);
  const sharesEdge = (l) => (leftCount.get(l) || 0) + (leftCount.get(l - 1) || 0) + (leftCount.get(l + 1) || 0) >= 2;
  const aligned = lefts.filter(sharesEdge).length;
  const edges = new Set(lefts).size;
  const withText = all.filter((b) => b.chars >= 2).length || 1;
  const centred = all.filter((b) => b.chars >= 2 && b.align === "center").length;

  return {
    width: VW,
    lead: leadBlock
      ? {
          kind: kindOf(leadBlock.text),
          text: leadBlock.text.slice(0, 60),
          size: leadBlock.size,
          weight: leadBlock.weight,
          y: Math.round(leadBlock.top - scrollY),
        }
      : null,
    ui: {
      ink: +(ink / grid.length).toFixed(3),
      reach: +(reach / grid.length).toFixed(3),
      media: +mediaShare.toFixed(3),
      items: fold.length + controls.length,
    },
    restraint: {
      sizes: sizes.length,
      sizes90: cover(sizes),
      weights: new Set(all.map((b) => b.weight)).size,
      families: new Set(all.map((b) => b.family)).size,
      colours: charsBy(colourKey, all).length,
      colours90: cover(charsBy(colourKey, all)),
      radii: radii.size,
      spacings: spacings.size,
      onGrid: +onGrid.toFixed(2),
    },
    alignment: {
      blocks: lefts.length,
      aligned: lefts.length ? +(aligned / lefts.length).toFixed(2) : 0,
      edges,
      centred: +(centred / withText).toFixed(2),
    },
    hierarchy: {
      body,
      ratio: leadBlock ? +(leadBlock.size / body).toFixed(2) : 0,
      levels: new Set(fold.map((b) => b.size)).size,
    },
  };
}

function walkHtml(target, out) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith(".html")) out.push(target);
    return;
  }
  for (const e of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkHtml(path.join(target, e.name), out);
    } else if (e.name.endsWith(".html")) out.push(path.join(target, e.name));
  }
}

export async function measurePages(inputs, { width = 1440, height = 900, shots = null, fullPage = false, timeout = 20000, onPage = null, theme = "light" } = {}) {
  const targets = [];
  for (const inp of inputs) {
    if (/^https?:\/\//i.test(inp)) targets.push({ kind: "url", url: inp, label: inp });
    else {
      const files = [];
      walkHtml(path.resolve(ROOT, inp), files);
      for (const f of files) targets.push({ kind: "file", file: f, label: path.relative(ROOT, f) || f });
    }
  }
  const files = targets.filter((t) => t.kind === "file").map((t) => t.file);
  const serveRoot = files.length ? serveRootFor(files) : null;
  const srv = files.length ? await startServer(serveRoot) : null;
  const browser = new CdpBrowser(findChrome());
  browser.start();
  const results = [];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    await browser.ready();
    for (const t of targets) {
      const url = t.kind === "url" ? t.url : fileToUrl(srv.baseUrl, serveRoot, t.file);
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
      try {
        await browser.send("Page.enable", {}, sessionId);
        await browser.send("Runtime.enable", {}, sessionId);
        await emulateTheme(browser, sessionId, theme);
        await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 480 }, sessionId);
        const loaded = browser.onceEvent("Page.loadEventFired", sessionId, timeout).catch(() => null);
        await browser.send("Page.navigate", { url }, sessionId, timeout);
        await loaded;
        await browser.send("Runtime.evaluate", { expression: "new Promise(r => setTimeout(r, 1200))", awaitPromise: true }, sessionId, timeout);
        await browser.send("Runtime.evaluate", { expression: SETTLE_EXPR, awaitPromise: true }, sessionId, timeout);
        const res = await browser.send("Runtime.evaluate", { expression: `(${inPageMeasure.toString()})()`, returnByValue: true }, sessionId, timeout);
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description?.split("\n")[0] || res.exceptionDetails.text);
        const out = { target: t.label, ...res.result.value };
        if (shots) {
          // A full page shows a landing page's pacing; it stops at 4,000px so a long page stays readable as one image.
          let params = { format: "png" };
          if (fullPage) {
            const { cssContentSize } = await browser.send("Page.getLayoutMetrics", {}, sessionId, timeout);
            const h = Math.min(4000, Math.max(height, Math.ceil(cssContentSize?.height ?? height)));
            params = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } };
          }
          const shot = await browser.send("Page.captureScreenshot", params, sessionId, timeout);
          const name = t.label.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(-80) + ".png";
          fs.writeFileSync(path.join(shots, name), Buffer.from(shot.data, "base64"));
          out.shot = path.join(shots, name);
        }
        results.push(out);
      } catch (err) {
        results.push({ target: t.label, error: err.message });
      } finally {
        await browser.send("Target.closeTarget", { targetId }).catch(() => {});
      }
      onPage?.(results.at(-1));
    }
  } finally {
    await browser.close();
    if (srv) srv.server.close();
  }
  return results;
}

const pct = (v) => `${Math.round(v * 100)}%`;

export function describe(m) {
  if (m.error) return `${m.target}\n  error: ${m.error}`;
  const l = m.lead ? `${m.lead.kind} "${m.lead.text}" ${m.lead.size}px/${m.lead.weight} at y${m.lead.y}` : "none";
  return [
    m.target,
    `  lead       ${l}`,
    `  ui share   ink ${pct(m.ui.ink)} · reach ${pct(m.ui.reach)} · media ${pct(m.ui.media)} · ${m.ui.items} items`,
    `  restraint  ${m.restraint.sizes} sizes (${m.restraint.sizes90} carry 90%) · ${m.restraint.weights} weights · ${m.restraint.families} families · ${m.restraint.colours} text colours (${m.restraint.colours90}) · ${m.restraint.radii} radii · ${m.restraint.spacings} spacings, ${pct(m.restraint.onGrid)} on 4px`,
    `  alignment  ${pct(m.alignment.aligned)} of ${m.alignment.blocks} blocks share an edge · ${m.alignment.edges} edges · ${pct(m.alignment.centred)} centred`,
    `  hierarchy  lead ${m.hierarchy.ratio}× body ${m.hierarchy.body}px · ${m.hierarchy.levels} sizes on the first screen`,
  ].join("\n");
}

export async function run(argv = process.argv.slice(2)) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, ...v] = a.slice(2).split("=");
      if (v.length) flags[k] = v.join("=");
      else if ((k === "width" || k === "shots" || k === "theme") && argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  const results = await measurePages(positional.length ? positional : ["."], {
    width: flags.width ? parseInt(flags.width, 10) : 1440,
    shots: typeof flags.shots === "string" ? flags.shots : null,
    fullPage: Boolean(flags.full),
    theme: themeOf(flags),
    onPage: flags.json ? null : (m) => console.log(describe(m) + "\n"),
  });
  if (flags.json) console.log(JSON.stringify(results, null, 2));
}
