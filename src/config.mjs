/**
 * .tellsrc: facts about a project that per-line tells-ok comments can't carry well.
 *
 *   {
 *     "shortcuts": ["⌘K", "⌘1", "⇧⌘3", "Ctrl+K"],
 *     "allow": { "default-font": "Apfel Grotezk is the brand face, licensed for the app" },
 *     "widths": [1440, 960]
 *   }
 *
 * `shortcuts` are keys the product really binds; fake-shortcut skips them and still flags any other.
 * `allow` accepts one rule for every file under the .tellsrc, with a written reason. Each hit it covers
 * is still reported as an allowed exception, so pick still counts it.
 * `widths` are the viewports the product is built for (a laptop-only back office needn't pass at 390px):
 * `tells render` uses them when no --widths is given.
 *
 * The nearest .tellsrc above a file applies (JSON, no comments).
 */
import fs from "node:fs";
import path from "node:path";

const cache = new Map(); // dir -> { file, config, error } | null

export function configFor(file) {
  let dir = path.dirname(path.resolve(file));
  const seen = [];
  for (;;) {
    if (cache.has(dir)) {
      const found = cache.get(dir);
      for (const d of seen) cache.set(d, found);
      return found;
    }
    seen.push(dir);
    const candidate = path.join(dir, ".tellsrc");
    if (fs.existsSync(candidate)) {
      let found;
      try {
        found = { file: candidate, config: normalize(JSON.parse(fs.readFileSync(candidate, "utf8"))) };
      } catch (e) {
        found = { file: candidate, config: normalize({}), error: `not valid JSON: ${e.message}` };
      }
      for (const d of seen) cache.set(d, found);
      return found;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const d of seen) cache.set(d, null);
  return null;
}

/** A viewport width tells can render: whole px, from 240 to 4096. */
export const isWidth = (w) => Number.isInteger(w) && w >= 240 && w <= 4096;

function normalize(raw) {
  const shortcuts = Array.isArray(raw.shortcuts) ? raw.shortcuts.map(String) : [];
  const allow = raw.allow && typeof raw.allow === "object" ? Object.fromEntries(Object.entries(raw.allow).map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""])) : {};
  const widths = Array.isArray(raw.widths) && raw.widths.length && raw.widths.every(isWidth) ? raw.widths : null;
  const problems = raw.widths !== undefined && !widths ? [`widths must be a list of px from 240 to 4096, like [1440, 960], not ${JSON.stringify(raw.widths)}`] : [];
  return { shortcuts: new Set(shortcuts.map(normalizeShortcut)), allow, widths, problems };
}

const MODS = "⌃⌥⇧⌘";

/** "Cmd + Shift + 3", "⇧⌘3" and "⌘⇧3" all become the same key. */
export function normalizeShortcut(s) {
  const t = String(s)
    .replace(/\b(?:cmd|command)\b/gi, "⌘")
    .replace(/\bshift\b/gi, "⇧")
    .replace(/\b(?:alt|option|opt)\b/gi, "⌥")
    .replace(/\b(?:ctrl|control)\b/gi, "⌃")
    .replace(/\b(?:enter|return)\b/gi, "↵")
    .replace(/[\s+]/g, "")
    .replace(/[,.;:)]+$/, "")
    .toUpperCase();
  const mods = [...t].filter((c) => MODS.includes(c)).sort((a, b) => MODS.indexOf(a) - MODS.indexOf(b)).join("");
  return mods + [...t].filter((c) => !MODS.includes(c)).join("");
}

// What fake-shortcut flags: ⌘ or ⌃ combos, ↵, Ctrl+K. Expanded to the whole key so ⇧⌘3 isn't read as ⌘3.
const SHORTCUT_RE = /[⇧⌥⌃⌘](?:\s*[⇧⌥⌃⌘])*\s*[^\s⇧⌥⌃⌘]*|↵|\bCtrl\s*\+?\s*K\b/gi;
export function shortcutsIn(text) {
  return [...text.matchAll(SHORTCUT_RE)]
    .filter((m) => /[⌘⌃↵]|ctrl/i.test(m[0]))
    .map((m) => ({ index: m.index, key: normalizeShortcut(m[0]), raw: m[0].trim() }));
}
