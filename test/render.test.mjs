import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const dir = path.join(here, "fixtures", "render");

const chrome = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);

function render(...args) {
  const r = spawnSync(process.execPath, [bin, "render", "--json", "--widths", "1440,390", ...args], { encoding: "utf8", timeout: 60_000 });
  assert.ok(r.stdout, r.stderr);
  return { code: r.status, out: JSON.parse(r.stdout) };
}

const skip = chrome ? false : "Chrome not found (set CHROME_PATH)";

for (const file of readdirSync(dir).filter((f) => f !== "clean.html")) {
  const id = file.replace(/\.html$/, "");
  test(`${id} fires on its fixture`, { skip }, () => {
    const { out } = render(path.join(dir, file));
    assert.ok(out.hits.some((h) => h.rule === id), `expected ${id}, got ${out.hits.map((h) => h.rule).join(", ") || "nothing"}`);
  });
}

test("clean page has no hits", { skip }, () => {
  const { code, out } = render(path.join(dir, "clean.html"));
  assert.deepEqual(out.hits, []);
  assert.equal(code, 0);
});
