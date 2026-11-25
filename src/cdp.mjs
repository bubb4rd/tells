/**
 * Shared zero-dependency headless Chrome (CDP over pipe) and local static file server.
 * Used by both `tells render` and rendered-mode `tells same`.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();

export const MIME = {
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

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Could not find Chrome/Chromium binary. Set CHROME_PATH=/path/to/chrome.");
}

export function startServer(rootDir) {
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

// Serve from the cwd when every target is inside it, so pages can load siblings like ../assets/x.svg.
// Otherwise serve from the deepest folder that holds every target, so paths outside the cwd still load.
export function serveRootFor(files, cwd = ROOT) {
  const inside = (f) => !path.relative(cwd, f).startsWith("..") && !path.isAbsolute(path.relative(cwd, f));
  if (files.every(inside)) return cwd;
  // One folder up, so a page in screens/ can still load ../system/ and ../data/.
  const common = commonDir(files);
  return path.dirname(common) === common ? common : path.dirname(common);
}

export function commonDir(files) {
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

export function fileToUrl(baseUrl, serveRoot, file) {
  return `${baseUrl}/${path.relative(serveRoot, file).split(path.sep).map(encodeURIComponent).join("/")}`;
}

export class CdpBrowser {
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

  /** Chrome can take well over 15s to start on a cold CI runner. Wait once, generously, before any page work. */
  ready(timeoutMs = 45000) {
    return this.send("Browser.getVersion", {}, undefined, timeoutMs);
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

export const SETTLE_EXPR =
  "(async () => { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); for (const a of (document.getAnimations ? document.getAnimations() : [])) { try { a.finish(); } catch {} } await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()";

/**
 * Headless Chrome follows the machine's appearance, so on a Mac in dark mode every page that honours
 * prefers-color-scheme renders its dark theme. Pin the scheme so results don't depend on the machine:
 * light by default, `--theme dark` to audit the dark theme.
 */
export const THEMES = ["light", "dark"];
export function themeOf(flags) {
  const t = flags?.theme === undefined || flags.theme === true ? "light" : String(flags.theme).toLowerCase();
  if (!THEMES.includes(t)) {
    console.error(`Error: --theme must be ${THEMES.join(" or ")}, not "${flags.theme}".`);
    process.exit(2);
  }
  return t;
}
export const emulateTheme = (browser, sessionId, theme = "light") =>
  browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, sessionId);
