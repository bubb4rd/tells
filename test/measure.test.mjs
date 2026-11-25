import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { measurePages } from "../src/measure.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const render = path.join(here, "fixtures", "render");
const chrome = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
const skip = chrome ? false : "Chrome not found (set CHROME_PATH)";

test("measure names what leads the first screen and how big it is", { skip }, async () => {
  const shots = mkdtempSync(path.join(tmpdir(), "tells-measure-"));
  const [stat, hero] = await measurePages([path.join(render, "stat-strip.html"), path.join(render, "template-hero-stack.html")], { shots });
  assert.equal(stat.lead.kind, "number");
  assert.equal(hero.lead.kind, "sentence");
  assert.ok(hero.hierarchy.ratio > 2, `hero lead should dwarf body text, got ${hero.hierarchy.ratio}`);
  assert.ok(hero.alignment.centred > 0.9, "the template hero stack is centred");
  for (const m of [stat, hero]) {
    assert.ok(existsSync(m.shot));
    assert.ok(m.ui.ink > 0 && m.ui.ink < 1);
    assert.ok(m.restraint.sizes >= m.restraint.sizes90);
  }
});

test("a lone emoji never leads", { skip }, async () => {
  const [m] = await measurePages([path.join(here, "..", "docs", "shots", "hero.html")]);
  assert.match(m.lead.text, /\p{L}/u);
});
