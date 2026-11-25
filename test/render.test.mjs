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

test("pages load assets from sibling folders inside the cwd", { skip }, () => {
  const { out } = render(path.join(here, "fixtures", "render-paths", "page", "index.html"));
  assert.ok(!out.hits.some((h) => h.rule === "broken-image"), out.hits.map((h) => `${h.rule}: ${h.detail ?? ""}`).join("; "));
});

test("contrast is measured after entrance animations settle", { skip }, () => {
  const { out } = render(path.join(here, "fixtures", "render-settled", "fade-in.html"));
  assert.ok(!out.hits.some((h) => h.rule === "low-contrast"), out.hits.map((h) => h.rule).join(", "));
});

test("tells-ok comments and data-tells-ok suppress render hits only with a reason", { skip }, () => {
  const { out } = render(path.join(here, "fixtures", "render-ok", "suppressed.html"));
  assert.ok(!out.hits.some((h) => h.rule === "split-surface"), "split-surface should be suppressed by comment");
  assert.ok(!out.hits.some((h) => h.rule === "nested-cards"), "nested-cards should be suppressed by data-tells-ok");
  assert.ok(out.hits.some((h) => h.rule === "mono-costume"), "bare tells-ok without a reason must not suppress");
  assert.deepEqual(out.allowed.map((a) => a.rule).sort(), ["nested-cards", "split-surface"]);
  assert.equal(out.summary.allowed, 2);
});

test("realistic product screen stays clean across all render rules", { skip }, () => {
  const { code, out } = render(path.join(here, "fixtures", "render-ok", "clean-product.html"));
  assert.deepEqual(out.hits, []);
  assert.equal(code, 0);
  const fp = out.fingerprints?.[0];
  assert.ok(fp, "render --json should include a rendered fingerprint");
  assert.equal(fp.layout, "sidebar-main");
  assert.equal(fp.colourRole, "accent-dots");
  assert.equal(fp.radius, 8);
});
