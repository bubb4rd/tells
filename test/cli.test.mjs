import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS, help, intFlag, parseCommandLine } from "../src/cli.mjs";
import { findChrome } from "../src/cdp.mjs";
import { parseWidths } from "../src/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const fixtures = path.join(here, "fixtures");
const tells = (args, opts = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 60_000, ...opts });
const tellsAsync = (args) =>
  new Promise((resolve) => execFile(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 60_000 }, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr })));

let chrome = null;
try {
  chrome = findChrome();
} catch {}
const skipChrome = chrome ? false : "Chrome not found (set CHROME_PATH)";

const scratch = () => mkdtempSync(path.join(tmpdir(), "tells-cli-"));

// --- usage mistakes exit 2 and say what to do -------------------------------

test("an unknown command names the nearest one", () => {
  const r = tells(["chek", "src"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command "chek"\. Did you mean tells check\?/);
});

test("an unknown flag fails instead of being ignored", () => {
  const r = tells(["check", "--strcit", path.join(fixtures, "check")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag --strcit\. Did you mean --strict\?/);
});

test("a misspelled make flag fails before its value joins the brief", () => {
  const dir = scratch();
  try {
    const r = tells(["make", "a bike shop's repair desk", "--varients", "3", "--agent", "false"], { cwd: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Did you mean --variants\?/);
    assert.deepEqual(readdirSync(dir), [], "nothing is written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a flag that needs a value says so", () => {
  const r = tells(["check", "--rule"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--rule needs a value/);
});

test("a missing path fails instead of scanning nothing", () => {
  for (const cmd of ["check", "fix", "render", "same", "measure"]) {
    const r = tells([cmd, "no/such/path"]);
    assert.equal(r.status, 2, cmd);
    assert.match(r.stderr, new RegExp(`tells ${cmd}: no/such/path doesn't exist`), cmd);
  }
});

test("a missing --lead or --against fails too", () => {
  assert.equal(tells(["consistent", "--lead", "nope.html", path.join(fixtures, "clean")]).status, 2);
  assert.equal(tells(["same", path.join(fixtures, "same"), "--against", "nope"]).status, 2);
});

test("a screenshot is pointed at make, not audited as nothing", () => {
  const dir = scratch();
  const png = path.join(dir, "shot.png");
  writeFileSync(png, "");
  try {
    for (const cmd of ["check", "render", "same", "measure"]) {
      const r = tells([cmd, png]);
      assert.equal(r.status, 2, cmd);
      assert.match(r.stderr, /is an image/, cmd);
      assert.match(r.stderr, /--reference/, cmd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check sends a URL to render", () => {
  const r = tells(["check", "https://example.com"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /tells render https:\/\/example\.com/);
});

test("a folder with no UI source fails instead of passing", () => {
  const dir = scratch();
  writeFileSync(path.join(dir, "notes.txt"), "no UI here");
  try {
    for (const cmd of ["check", "fix"]) {
      const r = tells([cmd, dir]);
      assert.equal(r.status, 2, cmd);
      assert.match(r.stderr, /no UI source in/, cmd);
    }
    const r = tells(["render", dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no HTML pages in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fix needs to be told what to rewrite", () => {
  const r = tells(["fix"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /tells fix \. for this whole folder/);
});

test("rules rejects an unknown set and lists consistent", () => {
  assert.equal(tells(["rules", "bogus"]).status, 2);
  const r = tells(["rules", "consistent"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /drift-typeface/);
});

test("numbers are checked, not clamped", () => {
  assert.equal(intFlag("variants", null, { min: 2, max: 12, fallback: 4 }), 4);
  assert.equal(intFlag("variants", "6", { min: 2, max: 12, fallback: 4 }), 6);
  for (const bad of ["0", "1", "13", "abc", "2.5"]) assert.throws(() => intFlag("variants", bad, { min: 2, max: 12, fallback: 4 }), /--variants takes a whole number from 2 to 12/);
  assert.deepEqual(parseWidths("1440, 390"), [1440, 390]);
  for (const bad of ["abc", "100", "1440,,390", "99999"]) assert.throws(() => parseWidths(bad), /--widths takes px/);
  const dir = scratch();
  try {
    assert.equal(tells(["make", "a bike shop's repair desk", "--variants", "0", "--agent", "false"], { cwd: dir }).status, 2);
    assert.deepEqual(readdirSync(dir), [], "nothing is written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("flag values aren't read as inputs", () => {
  assert.deepEqual(parseCommandLine("same", ["a", "--against", "b", "--house=c", "--json"]), {
    positional: ["a"],
    values: [
      { name: "against", value: "b" },
      { name: "house", value: "c" },
    ],
  });
});

// --- help --------------------------------------------------------------------

test("every command has its own help, without running", () => {
  for (const cmd of Object.keys(COMMANDS)) {
    // CHROME_PATH points nowhere: help must not start Chrome or scan the folder.
    const r = tells([cmd, "--help"], { env: { ...process.env, CHROME_PATH: "/nowhere" } });
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    assert.ok(r.stdout.startsWith(`tells ${cmd} `), cmd);
    assert.match(r.stdout, /Example/, cmd);
  }
  assert.equal(tells(["help", "make"]).stdout, tells(["make", "-h"]).stdout);
});

test("the README lists the same commands and flags as --help", () => {
  const readme = readFileSync(path.join(here, "..", "README.md"), "utf8").split("\n").map((l) => l.trim());
  const lines = help().split("\n").filter((l) => /^\s+(tells \w|--)/.test(l)).map((l) => l.trim());
  const missing = lines.filter((l) => !readme.includes(l));
  assert.deepEqual(missing, [], "run `node bin/tells.mjs --help` and copy its Usage and Flags into the README");
});

// --- Chrome --------------------------------------------------------------------

test("a wrong CHROME_PATH is an error, not a fall back", () => {
  assert.throws(() => findChrome({ env: { CHROME_PATH: "/nowhere/chrome" }, exists: () => false }), /CHROME_PATH is \/nowhere\/chrome/);
  const r = tells(["render", path.join(fixtures, "clean")], { env: { ...process.env, CHROME_PATH: "/nowhere/chrome" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CHROME_PATH/);
});

test("Chrome is found on the PATH and in Windows installs", () => {
  const exists = (p) => p === "/opt/bin/chromium" || p === "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assert.equal(findChrome({ env: { PATH: "/usr/local/bin:/opt/bin" }, platform: "linux", exists }), "/opt/bin/chromium");
  assert.equal(findChrome({ env: { "PROGRAMFILES(X86)": "C:\\Program Files (x86)", PATH: "" }, platform: "win32", exists }), "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  assert.throws(() => findChrome({ env: { PATH: "" }, platform: "linux", exists: () => false }), /couldn't find Chrome, Chromium or Edge/);
});

// --- pages that don't load fail instead of being audited -----------------------

test("render fails on a page that won't load or answers 404", { skip: skipChrome }, async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html lang=en><title>ok</title><h1>Repairs due today</h1><p>Three bikes.</p></html>");
    } else {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>Not found</h1>");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const free = net.createServer();
  await new Promise((r) => free.listen(0, "127.0.0.1", r));
  const dead = free.address().port;
  await new Promise((r) => free.close(r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await tellsAsync(["render", `${base}/ok`, "--widths", "1440"])).status, 0);
    const missing = await tellsAsync(["render", `${base}/missing`, "--widths", "1440"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /answered HTTP 404/);
    const refused = await tellsAsync(["render", `http://127.0.0.1:${dead}/`, "--widths", "1440"]);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /couldn't load .*ERR_CONNECTION_REFUSED/);
    const measured = await tellsAsync(["measure", `http://127.0.0.1:${dead}/`]);
    assert.equal(measured.status, 2);
  } finally {
    server.close();
  }
});

// Headless Chrome sometimes stops producing frames for a tab partway through a long run. Waiting on
// requestAnimationFrame then hung, and a folder of ~60 pages died with "CDP timeout on Runtime.evaluate".
test("render gets through every fixture in one run", { skip: skipChrome }, () => {
  const r = tells(["render", fixtures, "--json"], { timeout: 180_000 });
  assert.ok(r.stdout, r.stderr);
  assert.ok(existsSync(fixtures));
  assert.equal(JSON.parse(r.stdout).targets.length, 74);
});
