import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const dir = path.join(here, "fixtures", "click");
const chrome = process.env.CHROME_PATH || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const skip = chrome ? false : "Chrome not found (set CHROME_PATH)";

function click(...files) {
  const r = spawnSync(process.execPath, [bin, "click", "--json", ...files.map((f) => path.join(dir, f))], { encoding: "utf8", timeout: 120_000 });
  assert.ok(r.stdout, r.stderr);
  return { code: r.status, out: JSON.parse(r.stdout) };
}

test("click finds dead controls, throwing handlers and broken links, and honours a written exception", { skip }, () => {
  const { code, out } = click("broken.html");
  const got = out.hits.map((h) => `${h.rule} ${h.detail}`).sort();
  assert.deepEqual(got, [
    'broken-link "Roasts" → missing.html',
    'click-error "Ship": ReferenceError: undefinedThing is not defined',
    'dead-control "Batch 1195"',
    'dead-control "Export"',
  ]);
  assert.deepEqual(out.allowed.map((a) => a.detail).sort(), ['"Copy"', '"Print"']);
  assert.equal(code, 1);
});

test("click passes controls that act on click or Enter, and skips the chosen tab", { skip }, () => {
  const { code, out } = click("ok.html");
  assert.deepEqual(out.hits, []);
  assert.equal(out.pages[0].controls, 2);
  assert.equal(code, 0);
});

test("click reports a page that throws while it loads", { skip }, () => {
  const { out } = click("throws-on-load.html");
  assert.deepEqual(out.hits.map((h) => h.rule), ["script-error"]);
});

test("click takes routes of a single-page app, and each press starts from a fresh page", { skip }, () => {
  // Each Start works once per page load, and moves the route. Leftover state would make drums 2 and 3 look dead.
  const r = spawnSync(process.execPath, [bin, "click", "--json", path.join(here, "fixtures", "spa", "index.html#/b"), path.join(here, "fixtures", "spa", "index.html#/a")], { encoding: "utf8", timeout: 120_000 });
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.hits, []);
  assert.deepEqual(out.pages.map((p) => [p.target.replace(/^.*fixtures\//, ""), p.controls]), [["spa/index.html#/b", 3], ["spa/index.html#/a", 0]]);
  assert.equal(r.status, 0);
});
