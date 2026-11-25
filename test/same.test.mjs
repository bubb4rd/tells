import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RULES } from "../src/same.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const dir = path.join(here, "fixtures", "same");
const rdir = path.join(here, "fixtures", "same-rendered");

const chrome = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
const skipChrome = chrome ? false : "Chrome not found (set CHROME_PATH)";

const same = (...args) => {
  const r = spawnSync(process.execPath, [bin, "same", ...args, "--json"], { encoding: "utf8", timeout: 60_000 });
  assert.ok(r.stdout, r.stderr);
  return { code: r.status, designs: JSON.parse(r.stdout).designs };
};
const sameAsync = (...args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "same", ...args, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (!stdout) return reject(new Error(stderr || `exit ${code}`));
      resolve({ code, designs: JSON.parse(stdout).designs });
    });
  });
const byName = (designs) => Object.fromEntries(designs.map((d) => [d.design, d]));
const rules = (d) => d.hits.map((h) => h.rule);

for (const { id } of RULES.filter((r) => r.id.startsWith("cluster-"))) {
  test(`${id} fires on its fixture, and no other cluster does`, () => {
    const { code, designs } = same(path.join(dir, "clusters", `${id}.css`));
    assert.deepEqual(rules(designs[0]), [id]);
    assert.equal(code, 1);
  });
}

test("house style is the look most siblings share", () => {
  const { designs } = same(path.join(dir, "house"));
  const d = byName(designs);
  assert.deepEqual(rules(d.match), ["house-style"]);
  assert.deepEqual(rules(d.distinct), []);
});

test("--house pins the house to one design", () => {
  const pin = ["--house", path.join(dir, "house", "a")];
  assert.deepEqual(rules(same(path.join(dir, "house", "match"), ...pin).designs[0]), ["house-style"]);
  assert.deepEqual(rules(same(path.join(dir, "house", "distinct"), ...pin).designs[0]), []);
});

test("a design with fewer than three siblings has no house to match", () => {
  const { designs } = same(path.join(dir, "copy", "one"));
  assert.equal(designs[0].house, null);
  assert.ok(!rules(designs[0]).includes("house-style"));
});

test("token copies are caught, and tells-ok allows one with a reason", () => {
  const { code, designs } = same(path.join(dir, "copy"));
  const d = byName(designs);
  assert.deepEqual(rules(d.one), ["token-copy"]);
  assert.deepEqual(rules(d.two), []);
  assert.deepEqual(d.two.allowed.map((a) => a.rule), ["token-copy"]);
  assert.equal(code, 1);
});

test("a distinct design exits 0", () => {
  const { code } = same(path.join(dir, "house", "distinct"), "--house", path.join(dir, "house", "a"));
  assert.equal(code, 0);
});

test("tokenless HTML automatically fingerprints in Chrome and catches cliché clusters", { skip: skipChrome }, () => {
  const { code, designs } = same(path.join(rdir, "glow-void.html"), "--no-siblings");
  assert.equal(designs[0].rendered, true);
  assert.deepEqual(rules(designs[0]), ["cluster-glow-void"]);
  assert.equal(code, 1);
});

test("rendered house style compares colour-role and layout axes across tokenless HTML designs", { skip: skipChrome }, () => {
  const { designs } = same(path.join(rdir, "house"));
  const d = byName(designs);
  assert.equal(d.match.rendered, true);
  assert.equal(d.match.axes.layout, "sidebar-main");
  assert.equal(d.match.axes["colour-role"], "accent-dots");
  assert.deepEqual(rules(d.match), ["house-style"]);
  assert.equal(d.distinct.axes.layout, "centered-hero");
  assert.equal(d.distinct.axes["colour-role"], "structural-field");
  assert.deepEqual(rules(d.distinct), []);
});

test("same fingerprints a live http URL against past designs", { skip: skipChrome }, async () => {
  const html = readFileSync(path.join(rdir, "house", "match", "index.html"), "utf8");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const { code, designs } = await sameAsync(`http://127.0.0.1:${port}/`, "--house", path.join(rdir, "house", "a"), "--rendered");
    assert.equal(designs[0].rendered, true);
    assert.deepEqual(rules(designs[0]), ["house-style"]);
    assert.equal(code, 1);
  } finally {
    server.close();
  }
});

test("--no-render skips browser fingerprinting on tokenless HTML", () => {
  const { designs } = same(path.join(rdir, "glow-void.html"), "--no-siblings", "--no-render");
  assert.ok(designs[0].error);
});
