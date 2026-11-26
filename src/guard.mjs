/**
 * Guards for a round of changes on a product taken in with --from: what changed that the notes didn't ask for.
 *
 * - tokens: a token value changed, added or removed that the round's write-up doesn't list under "Tokens changed";
 * - traits: a screen the notes didn't name whose typeface, headings, page, panel, marks or shell drifted from how it
 *   came (the same comparison `tells consistent` makes, with the baseline as the lead);
 * - shots: how much of each screen's screenshot changed since the last round (reported, never blocking: clocks and
 *   live data move pixels too);
 * - hits: only hits the product didn't have when it came in count against the round.
 */
import fs from "node:fs";
import { compare } from "./consistent.mjs";
import { CdpBrowser, findChrome } from "./cdp.mjs";
import { diffTokens } from "./ingest.mjs";

/** The tokens a round's write-up says it changed: every `--name` under a "Tokens changed" heading or line. */
export function listedTokens(text) {
  const out = new Set();
  const lines = String(text ?? "").split("\n");
  let inSection = false;
  for (const l of lines) {
    if (/^#+\s/.test(l)) inSection = /tokens changed/i.test(l);
    const here = /tokens changed/i.test(l);
    if (inSection || here) for (const m of l.matchAll(/--[\w-]+/g)) out.add(m[0]);
  }
  return out;
}

/** The text of one round in a running log (POLISH.md): from "## Round n" to the next "## Round". */
export function roundText(log, n) {
  const m = new RegExp(`^## Round ${n}\\b[\\s\\S]*?(?=^## Round \\d|(?![\\s\\S]))`, "m").exec(String(log ?? ""));
  return m ? m[0] : "";
}

/** Token changes the round didn't list. */
export function tokenViolations(before, after, listed) {
  return diffTokens(before, after).filter((c) => !listed.has(c.token));
}

/**
 * Screens whose traits drifted from the baseline, other than the ones the round was allowed to change.
 * `base` and `now` are consistent's `screens` ([{target, traits}]).
 */
export function traitViolations(base, now, allowed = new Set()) {
  const out = [];
  for (const s of now) {
    if (allowed.has(s.target)) continue;
    const b = base.find((x) => x.target === s.target);
    if (!b) continue;
    const { hits } = compare([{ label: "baseline", traits: b.traits }, { label: s.target, traits: s.traits }], ["baseline"]);
    for (const h of hits) if (h.target === s.target) out.push({ target: s.target, rule: h.rule, detail: h.detail });
  }
  return out;
}

/** Hits the product didn't have when it came in, as counts in the same shape as the round's line. */
export function newHits(audit, baseline, signature) {
  const known = new Set(baseline);
  const out = {};
  for (const tool of ["consistent", "check", "render", "click"]) {
    const fresh = (audit[tool]?.hits ?? []).filter((h) => !known.has(signature(tool, h)));
    out[tool] = { errors: fresh.filter((h) => h.severity === "error").length, warnings: fresh.filter((h) => h.severity === "warn").length, hits: fresh, error: audit[tool]?.error };
  }
  return out;
}

// In the page: draw both images and count the pixels that differ by more than a little in any channel.
const DIFF = (a, b) => `(async () => {
  const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
  const w = Math.max(x.width, y.width), h = Math.max(x.height, y.height);
  const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
  const p = px(x), q = px(y);
  let changed = 0;
  for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24) changed++;
  return { changed: changed / (w * h), size: [x.width, x.height, y.width, y.height] };
})()`;

/** For each [before.png, after.png]: the share of pixels that changed (0–1), or null when either is missing. */
export async function diffShots(pairs) {
  const present = pairs.filter(([a, b]) => fs.existsSync(a) && fs.existsSync(b));
  const result = new Map(pairs.map((p) => [p, null]));
  if (!present.length) return pairs.map(() => null);
  const b = new CdpBrowser(findChrome());
  b.start();
  try {
    await b.ready();
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: s } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Runtime.enable", {}, s);
    const uri = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
    for (const pair of present) {
      const r = await b.send("Runtime.evaluate", { expression: DIFF(uri(pair[0]), uri(pair[1])), awaitPromise: true, returnByValue: true }, s, 60000);
      result.set(pair, r.result?.value?.changed ?? null);
    }
  } finally {
    await b.close();
  }
  return pairs.map((p) => result.get(p));
}
