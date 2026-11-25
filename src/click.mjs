/**
 * tells click: press every control on a page, from a fresh start, and report the ones that break or do nothing.
 *
 * Usage:
 *   tells click <files|dirs...> [--json] [--strict] [--theme light|dark]
 *
 * Agents in `make` can't open a browser, so a page can pass every render rule with dead buttons and a
 * script that throws on the first click. This loads each page in headless Chrome at 1440px with its
 * storage cleared, then, one control at a time (reloading between, so each press starts from the seed):
 * clicks it, presses Enter on it if it isn't a real button, and compares the page before and after:
 * its markup, its storage, an open dialog and its address. Also: errors thrown while loading, and
 * relative links to files that don't exist.
 *
 * Allow one hit with <!-- tells-ok: dead-control <reason> --> just before the control, data-tells-ok="dead-control <reason>"
 * on it, or .tellsrc "allow".
 */
import fs from "node:fs";
import path from "node:path";
import { display, makePaint } from "./check.mjs";
import { CdpBrowser, emulateTheme, findChrome, navigate, startServer, serveRootFor, fileToUrl, themeOf } from "./cdp.mjs";
import { configFor } from "./config.mjs";

export const RULES = [
  { id: "script-error", severity: "error", fix: "The page throws while it loads. Fix the script: every control after the error is likely dead." },
  { id: "click-error", severity: "error", fix: "Pressing this control throws. Fix the handler." },
  { id: "dead-control", severity: "warn", fix: "Pressing this changes nothing on the page or in its store. Wire it to an action, or remove it. A thing you drag or move with arrow keys isn't a button: drop role=button." },
  { id: "broken-link", severity: "error", fix: "This link points at a file that doesn't exist. Build the page, or link to one that does." },
];
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
const SKIP = /(?:^|[\\/])(?:shots|references|work|node_modules|\.git)(?:[\\/]|$)|(?:^|[\\/])(?:study|reference[\w-]*)\.html$/i;
const PER_PAGE = 60; // controls pressed per page
const PER_KIND = 3; // identical controls (same label, same class) pressed per page

function htmlFiles(target, out) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat) return process.stderr.write(`tells click: skipping missing path ${display(target)}\n`);
  if (stat.isFile()) return /\.html$/i.test(target) && out.push(target);
  for (const e of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(target, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) htmlFiles(p, out);
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
}

// In the page: the controls worth pressing, in document order.
const CONTROLS = `(() => [...document.querySelectorAll('button, [role=button], [role=tab], summary')].filter((el) => {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (getComputedStyle(el).visibility === 'hidden' || el.closest('dialog:not([open]), [hidden], [inert]')) return false;
  // already the chosen one: pressing it again rightly does nothing
  return !['aria-pressed', 'aria-selected', 'aria-current'].some((a) => el.getAttribute(a) === 'true' || el.getAttribute(a) === 'page');
}))()`;
const DESCRIBE = `${CONTROLS}.map((el) => ({
  label: (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName.toLowerCase()).trim().replace(/\\s+/g, ' ').slice(0, 48),
  kind: el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim() : ''),
  real: el.tagName === 'BUTTON' || el.tagName === 'SUMMARY',
  ok: (() => {
    // data-tells-ok="dead-control <reason>" on the control or a parent, or <!-- tells-ok: dead-control <reason> --> just before one
    const re = /(?:^|;|tells-ok:)\\s*dead-control\\s+([^;\\n]+?)\\s*(?:-->|;|$)/i;
    for (let c = el; c && c.nodeType === 1; c = c.parentElement) {
      const m = re.exec(c.getAttribute('data-tells-ok') || '');
      if (m) return m[1].trim();
      for (let p = c.previousSibling; p && (p.nodeType === 8 || (p.nodeType === 3 && !p.nodeValue.trim())); p = p.previousSibling) {
        const k = p.nodeType === 8 && re.exec('tells-ok:' + p.nodeValue.replace(/^\\s*tells-ok:/i, ''));
        if (k) return k[1].trim();
      }
    }
    return null;
  })(),
}))`;
const SNAP = `(() => { let ls = ''; try { ls = Object.keys(localStorage).sort().map((k) => k + '=' + localStorage[k]).join('|') + Object.keys(sessionStorage).sort().map((k) => k + '=' + sessionStorage[k]).join('|'); } catch {} return [location.href, document.body ? document.body.innerHTML : '', ls, document.querySelectorAll('dialog[open]').length].join('\\u0000'); })()`;
const LINKS = `[...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), url: a.href, label: (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 48) }))`;

/** Press every control on each page. Returns [{target, file, controls, hits: [{rule, detail, ok?}]}]. */
export async function clickPages(files, { theme = "light" } = {}) {
  const chrome = findChrome();
  const root = serveRootFor(files);
  const { server, baseUrl } = await startServer(root);
  const b = new CdpBrowser(chrome);
  b.start();
  const results = [];
  try {
    await b.ready();
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: s } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Page.enable", {}, s);
    await b.send("Runtime.enable", {}, s);
    await b.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    await emulateTheme(b, s, theme);
    let thrown = [];
    const onThrow = (p) => thrown.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || "error").split("\n")[0].slice(0, 160));
    b.listeners.set(`${s}:Runtime.exceptionThrown`, new Set([onThrow]));
    const ev = async (expression) => (await b.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, s)).result.value;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // A page that won't load, or answers 4xx/5xx, stops the run: its error page isn't the page.
    const load = async (url) => {
      await navigate(b, s, url, { timeout: 20000 });
      await wait(250);
    };
    const fresh = async (url) => {
      await ev("try { localStorage.clear(); sessionStorage.clear(); } catch {}");
      await load(url);
    };

    for (const file of files) {
      const url = fileToUrl(baseUrl, root, file);
      const hits = [];
      await load(url);
      thrown = [];
      await fresh(url);
      for (const t of new Set(thrown)) hits.push({ rule: "script-error", detail: t });

      for (const l of await ev(LINKS)) {
        if (!l.url.startsWith(baseUrl) || /^#|^(mailto|tel|javascript):/i.test(l.href)) continue;
        const target = path.join(root, decodeURIComponent(new URL(l.url).pathname));
        const stat = fs.statSync(target, { throwIfNoEntry: false });
        if (!stat || (stat.isDirectory() && !fs.existsSync(path.join(target, "index.html")))) hits.push({ rule: "broken-link", detail: `"${l.label || l.href}" → ${l.href}` });
      }

      const controls = await ev(DESCRIBE);
      const perKind = new Map();
      let pressed = 0;
      for (let i = 0; i < controls.length && pressed < PER_PAGE; i++) {
        const c = controls[i];
        const kind = `${c.kind}|${c.label}`;
        if ((perKind.get(kind) || 0) >= PER_KIND) continue;
        perKind.set(kind, (perKind.get(kind) || 0) + 1);
        pressed++;
        await fresh(url);
        thrown = [];
        const before = await ev(SNAP);
        const found = await ev(`(() => { const el = ${CONTROLS}[${i}]; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
        if (!found) continue;
        await wait(350);
        let after = await ev(SNAP).catch(() => null);
        if (after === before && !c.real) {
          // a role=button that isn't a <button>: try the key a keyboard user would press
          await ev(`(() => { const el = ${CONTROLS}[${i}]; if (!el) return; el.focus(); for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true })); })()`);
          await wait(350);
          after = await ev(SNAP).catch(() => null);
        }
        const errs = [...new Set(thrown)];
        if (errs.length) hits.push({ rule: "click-error", detail: `"${c.label}": ${errs[0]}` });
        else if (after === before) hits.push({ rule: "dead-control", detail: `"${c.label}"`, ok: c.ok });
      }
      results.push({ target: display(file), file, controls: pressed, hits });
    }
  } finally {
    await b.close();
    server.close();
  }
  return results;
}

export async function run(argv = process.argv.slice(2)) {
  const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => [a.slice(2).split("=")[0], a.includes("=") ? a.split("=").slice(1).join("=") : true]));
  const themeAt = argv.indexOf("--theme");
  if (themeAt >= 0 && argv[themeAt + 1]) flags.theme = argv[themeAt + 1];
  if (flags.rules) {
    for (const r of RULES) console.log(`${r.id.padEnd(14)} ${r.severity.padEnd(6)} ${r.fix}`);
    return;
  }
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--theme");
  const files = [];
  for (const p of positional.length ? positional : ["."]) htmlFiles(path.resolve(p), files);
  if (!files.length) {
    console.error("tells click: no HTML pages found.");
    process.exit(2);
  }
  const results = await clickPages(files, { theme: themeOf(flags) });

  const hits = [];
  const allowed = [];
  for (const r of results) {
    for (const h of r.hits) {
      const rule = RULE_BY_ID.get(h.rule);
      const full = { target: r.target, rule: h.rule, severity: rule.severity, detail: h.detail, fix: rule.fix };
      const rc = configFor(r.file)?.config.allow?.[h.rule];
      if (h.ok || rc) allowed.push({ ...full, reason: h.ok || `.tellsrc: ${rc}` });
      else hits.push(full);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({ pages: results.map((r) => ({ target: r.target, controls: r.controls })), hits, allowed }, null, 2));
  } else {
    const paint = makePaint(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
    const out = [];
    const w = Math.max(...RULES.map((r) => r.id.length));
    for (const r of results) {
      const mine = hits.filter((h) => h.target === r.target);
      out.push((mine.length ? paint.red("✗ ") : paint.green("✓ ")) + r.target + paint.dim(`  ${r.controls} controls pressed`));
      for (const h of mine) out.push(`    ${h.severity === "error" ? paint.red("[error]") : paint.yellow("[warn] ")} ${h.rule.padEnd(w)}  ${h.detail}`);
    }
    if (allowed.length) {
      out.push("", paint.bold("Allowed"));
      for (const a of allowed) out.push(`  ${paint.green("[ok]")} ${a.target}  ${a.rule}  ${a.detail}  ${a.reason}`);
    }
    const rules = [...new Set(hits.map((h) => h.rule))];
    if (rules.length) {
      out.push("", paint.bold("Fixes"));
      for (const id of rules) out.push(`  ${paint.cyan(id.padEnd(w))}  ${RULE_BY_ID.get(id).fix}`);
    }
    const errors = hits.filter((h) => h.severity === "error").length;
    const warns = hits.length - errors;
    const n = `${results.length} page${results.length === 1 ? "" : "s"}`;
    out.push("", hits.length ? `${errors} error${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"} on ${n}.` : paint.green(`Every control on ${n} does something.`));
    console.log(out.join("\n"));
  }
  if (hits.some((h) => h.severity === "error" || (flags.strict && h.severity === "warn"))) process.exitCode = 1;
}
