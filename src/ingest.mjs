/**
 * tells make --product --from <dir>: take in a product someone already approved, without restyling it.
 *
 * The deterministic half of the ingest stage: copy the product (never touching the source), find its screens
 * (pages, or the routes of a single-page app), read its design tokens, and put back anything the describing
 * agent changed that it shouldn't have. The agent half is make.ingest.md.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CdpBrowser, findChrome, startServer, fileToUrl, navigate, SETTLE_EXPR } from "./cdp.mjs";

// Not part of the product: screenshots, dependencies, history, and scratch copies (styles.v3a.css.bak, app.v2.js).
const SKIP_DIR = new Set(["shots", "node_modules", ".git", "baseline", "rounds"]);
const SCRATCH = /\.bak$|\.v\d+[a-z]?\.(?:css|js|mjs|html)$|^\.DS_Store$/i;
// What the describing agent may write. Everything else stays as it came.
export const INGEST_DOCS = ["SYSTEM.md", "CONTRACTS.md", "APPROVED.md", "PRODUCT.md"];

/** Copy the product into `to`, leaving out scratch. Returns the paths it left out, relative to `from`. */
export function copyProduct(from, to) {
  const skipped = [];
  const walk = (a, b, rel) => {
    fs.mkdirSync(b, { recursive: true });
    for (const e of fs.readdirSync(a, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() ? SKIP_DIR.has(e.name) : SCRATCH.test(e.name)) {
        skipped.push(r);
        continue;
      }
      if (e.isDirectory()) walk(path.join(a, e.name), path.join(b, e.name), r);
      else if (e.isFile()) fs.copyFileSync(path.join(a, e.name), path.join(b, e.name));
    }
  };
  walk(from, to, "");
  return skipped;
}

/** Every file under `dir` (relative path → sha1), so a later run can tell what changed. */
export function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(path.join(d, e.name), r);
      } else if (e.isFile()) out[r] = crypto.createHash("sha1").update(fs.readFileSync(path.join(d, e.name))).digest("hex");
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Put `dir` back to how `source` has it, except for the files in `keep`: an edited file is restored, an added one
 * removed, a deleted one copied back. Returns what it put back, as [{file, was}].
 */
export function restoreExcept(dir, source, keep) {
  const now = snapshot(dir);
  const want = snapshot(source);
  const reverted = [];
  for (const [file, hash] of Object.entries(now)) {
    if (keep(file)) continue;
    if (!(file in want)) {
      fs.rmSync(path.join(dir, file));
      reverted.push({ file, was: "added" });
    } else if (want[file] !== hash) {
      fs.copyFileSync(path.join(source, file), path.join(dir, file));
      reverted.push({ file, was: "changed" });
    }
  }
  for (const file of Object.keys(want)) {
    if (keep(file) || file in now) continue;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(dir, file));
    reverted.push({ file, was: "deleted" });
  }
  return reverted;
}

/**
 * Custom properties in the product's CSS, by the selector block that sets them:
 * { ":root[data-theme=\"dark\"]": { "--green": "#3FBF6A", … }, … }. A regex over the files, no CSS engine:
 * enough to tell when a value changed. Blocks inside @media keep their own selector.
 */
export function readTokens(dir) {
  const tokens = {};
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(path.join(d, e.name));
      } else if (/\.css$/i.test(e.name) && !SCRATCH.test(e.name)) files.push(path.join(d, e.name));
    }
  };
  walk(dir);
  for (const f of files.sort()) {
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = [...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)];
      if (!decls.length) continue;
      const selector = m[1].trim().replace(/\s+/g, " ");
      tokens[selector] = { ...(tokens[selector] ?? {}) };
      for (const d of decls) tokens[selector][d[1]] = d[2].trim();
    }
  }
  return tokens;
}

/** [{selector, token, was, now}] for every token changed, added or removed between two readTokens results. */
export function diffTokens(before, after) {
  const changes = [];
  for (const selector of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[selector] ?? {};
    const b = after[selector] ?? {};
    for (const token of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[token] !== b[token]) changes.push({ selector, token, was: a[token] ?? null, now: b[token] ?? null });
    }
  }
  return changes;
}

/** Whether the product draws a dark theme of its own, so it gets a dark baseline too. */
export function hasDarkTheme(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(path.join(d, e.name));
      } else if (/\.(css|html)$/i.test(e.name) && !SCRATCH.test(e.name)) files.push(path.join(d, e.name));
    }
  };
  walk(dir);
  return files.some((f) => /data-theme\s*=\s*["']?dark|prefers-color-scheme\s*:\s*dark/i.test(fs.readFileSync(f, "utf8")));
}

const htmlIn = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name) && !/^(references?|work|study)$/i.test(e.name)) walk(path.join(d, e.name), r);
      } else if (/\.html$/i.test(e.name) && !SCRATCH.test(e.name) && !/^(study|reference[\w-]*)\.html$/i.test(e.name)) out.push(r);
    }
  };
  walk(dir, "");
  return out;
};

// In the page: the routes its navigation links to, as {id, hash, label}. #/inbox and #inbox both count; a link to
// an element on the page (#top, #main) doesn't.
const ROUTES = `(() => {
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const href = a.getAttribute('href');
    const m = /^#\\/?([a-z0-9][\\w-]*)/i.exec(href);
    if (!m || (!href.startsWith('#/') && document.getElementById(m[1]))) continue;
    const id = m[1].toLowerCase();
    if (!seen.has(id)) seen.set(id, { id, hash: href.startsWith('#/') ? '#/' + m[1] : '#' + m[1], label: (a.innerText || a.getAttribute('aria-label') || '').trim().split('\\n')[0].trim() });
  }
  return [...seen.values()];
})()`;
// What a route shows, to tell a built route from one that falls back to the default.
const SHOWS = `(() => document.title + '\\u0000' + (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim())()`;

/**
 * The product's screens. A folder of pages: one per HTML file. A single-page app (one entry page whose navigation
 * links to #routes): one per route, found by rendering the entry, and a route that shows what the default route
 * shows isn't built yet. Each screen lists the files that are its own (screens/<id>.*, data/<id>.*); one with none
 * is drawn by the shell (inShell).
 */
export async function discoverScreens(dir) {
  const pages = htmlIn(dir);
  if (!pages.length) throw new Error(`no HTML pages in ${dir}`);
  const entry = pages.includes("index.html") ? "index.html" : pages.length === 1 ? pages[0] : null;
  const filesOf = (id, page = null) => {
    const own = [];
    for (const sub of ["screens", "data"]) {
      const d = path.join(dir, sub);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) if (path.parse(f).name === id && !SCRATCH.test(f)) own.push(`${sub}/${f}`);
    }
    if (page && !own.includes(page)) own.unshift(page);
    return own.sort();
  };

  let routes = [];
  const chrome = findChrome();
  const { server, baseUrl } = await startServer(dir);
  const b = new CdpBrowser(chrome);
  b.start();
  const titles = {};
  try {
    await b.ready();
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: s } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Page.enable", {}, s);
    await b.send("Runtime.enable", {}, s);
    await b.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    const ev = async (expression) => (await b.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, s)).result.value;
    const open = async (url) => {
      await navigate(b, s, "about:blank");
      await navigate(b, s, url, { timeout: 20000, lenient: true });
      await ev(SETTLE_EXPR);
    };
    if (entry) {
      await open(fileToUrl(baseUrl, dir, path.join(dir, entry)));
      routes = await ev(ROUTES);
      if (routes.length >= 2) {
        const fallback = await ev(SHOWS);
        for (const r of routes) {
          await open(fileToUrl(baseUrl, dir, path.join(dir, entry)) + r.hash);
          r.shows = await ev(SHOWS);
        }
        // The default route is the one that shows what the bare entry shows; any other route showing it isn't built.
        const home = routes.find((r) => r.shows === fallback)?.id ?? routes[0].id;
        for (const r of routes) r.built = r.id === home || r.shows !== fallback;
      }
    }
    if (routes.length < 2) {
      for (const p of pages) {
        await open(fileToUrl(baseUrl, dir, path.join(dir, p)));
        titles[p] = await ev("(document.querySelector('h1')?.innerText || document.title || '').trim()");
      }
    }
  } finally {
    await b.close();
    server.close();
  }

  if (routes.length >= 2) {
    return {
      layout: "spa",
      entry,
      screens: routes.map((r) => {
        const files = filesOf(r.id);
        return { id: r.id, job: r.label || r.id, target: `${entry}${r.hash}`, files, inShell: !files.length, built: r.built };
      }),
    };
  }
  return {
    layout: "pages",
    entry: null,
    screens: pages.map((p) => {
      const id = path.basename(p, ".html").toLowerCase();
      return { id, job: titles[p] || id, target: p, files: filesOf(id, p), inShell: false, built: true };
    }),
  };
}

/** The brief, when none is given: the entry page's <title>, else the folder's name. */
export function briefFrom(dir, entry) {
  const html = entry && fs.existsSync(path.join(dir, entry)) ? fs.readFileSync(path.join(dir, entry), "utf8") : "";
  const title = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
  return title || path.basename(dir).replace(/[-_]+/g, " ");
}
