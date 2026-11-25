import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ANGLES, isLanding, prompts, studyPrompts } from "../src/make.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const pick = path.join(here, "fixtures", "pick");
const rhouse = path.join(here, "fixtures", "same-rendered", "house");
const chrome = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
const skipChrome = chrome ? false : "Chrome not found (set CHROME_PATH)";
const agent = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-agent.mjs")}"`;
const tells = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
const tellsIn = (env, ...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const icon = path.join(here, "..", "docs", "assets", "icon-dark.png");

test("pick ranks by errors, then written exceptions, and says why each loser lost", () => {
  const r = tells("pick", path.join(pick, "rough"), path.join(pick, "excused"), path.join(pick, "clean"), "--no-render", "--json");
  const { winner, ranking } = JSON.parse(r.stdout);
  assert.match(winner, /clean$/);
  assert.deepEqual(ranking.map((m) => path.basename(m.variant)), ["clean", "excused", "rough"]);
  assert.match(ranking[1].why, /1 written exception/);
  assert.match(ranking[2].why, /3 rules broken, against 0 .*check:pill-radius/);
  assert.equal(r.status, 0);
});

test("pick needs at least two variants", () => {
  assert.equal(tells("pick", path.join(pick, "clean")).status, 2);
});

test("every variant gets the brief and its own angle", () => {
  const ps = prompts("tide alerts for a harbour town", 4);
  assert.equal(new Set(ps).size, 4);
  ps.forEach((p, i) => {
    assert.match(p, /tide alerts for a harbour town/);
    assert.ok(p.includes(ANGLES[i]));
    assert.match(p, new RegExp(`variant ${i + 1} of 4`));
  });
});

test("--dry-run writes the prompts and runs nothing", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  assert.equal(tells("make", "a tide table", "--variants", "3", "--out", out, "--dry-run").status, 0);
  for (const v of ["v1", "v2", "v3"]) {
    assert.ok(existsSync(path.join(out, v, "PROMPT.md")));
    assert.ok(!existsSync(path.join(out, v, "index.html")));
  }
});

test("make builds, fixes, picks and reports with no input after the brief", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "tide alerts for a harbour town", "--variants", "3", "--out", out, "--agent", agent, "--no-render");
  assert.equal(r.status, 0, r.stderr);
  const report = readFileSync(path.join(out, "REPORT.md"), "utf8");
  assert.match(report, /Winner: \*\*v2\*\*/);
  assert.match(report, /\*\*v1:\*\* 1 rule broken, against 0 \(check:generic-cta\)/); // fix already took the pill and the arrow
  assert.match(report, /\*\*v3:\*\* 1 written exception/);
  assert.doesNotMatch(readFileSync(path.join(out, "v1", "index.html"), "utf8"), /999px|→/);
});

test("pick reuses render fingerprints to choose off-house tokenless variants", { skip: skipChrome }, () => {
  const r = tells("pick", path.join(rhouse, "match"), path.join(rhouse, "distinct"), "--house", path.join(rhouse, "a"), "--json");
  const { winner, ranking } = JSON.parse(r.stdout);
  assert.match(winner, /distinct$/);
  assert.equal(ranking[0].houseOf, 8);
  assert.ok(ranking[1].lands.includes("house-style"), `expected match to land on house-style, got ${JSON.stringify(ranking[1])}`);
  assert.equal(r.status, 0);
});

test("study prompts name every reference, carry no angle, and put the rule set above the reference", () => {
  const refs = [
    { name: "github-issues", url: "https://github.com/vercel/next.js/issues", why: "dense rows, quiet chrome" },
    { name: "plausible", url: null, why: null },
  ];
  const ps = studyPrompts("a shift handover for night nurses", 2, refs);
  assert.equal(ps.length, 2);
  for (const [i, p] of ps.entries()) {
    assert.match(p, /a shift handover for night nurses/);
    assert.match(p, new RegExp(`variant ${i + 1} of 2`));
    assert.match(p, /`reference-1\.png`: github-issues \(https:\/\/github\.com\/vercel\/next\.js\/issues\)\. Why it's good: dense rows, quiet chrome/);
    assert.match(p, /`reference-2\.png`: plausible\n/);
    assert.ok(!ANGLES.some((a) => p.includes(a)));
    assert.match(p, /The rule set wins over the reference[\s\S]*anti-slop\.md/);
    assert.match(p, /check index\.html --strict/);
  }
});

test("refs add, list and remove keep the library outside the repo", () => {
  const lib = mkdtempSync(path.join(tmpdir(), "tells-refs-"));
  const env = { TELLS_REFERENCES: lib };
  assert.equal(tellsIn(env, "refs", "add", icon, "--kind", "brand").status, 2, "a reference needs a reason");
  const add = tellsIn(env, "refs", "add", icon, "--kind", "brand", "--why", "one mark, no noise", "--name", "icon");
  assert.equal(add.status, 0, add.stderr);
  assert.ok(existsSync(path.join(lib, "icon.png")));
  const [entry] = JSON.parse(readFileSync(path.join(lib, "index.json"), "utf8"));
  assert.deepEqual({ ...entry, added: undefined }, { name: "icon", kind: "brand", why: "one mark, no noise", url: null, shot: "icon.png", added: undefined });
  assert.match(tellsIn(env, "refs").stdout, /brand\s+icon\s+one mark, no noise/);
  assert.equal(tellsIn(env, "refs", "remove", "icon").status, 0);
  assert.ok(!existsSync(path.join(lib, "icon.png")));
});

test("make --kind copies every library reference of that kind into each variant", () => {
  const lib = mkdtempSync(path.join(tmpdir(), "tells-refs-"));
  const env = { TELLS_REFERENCES: lib };
  tellsIn(env, "refs", "add", icon, "--kind", "list", "--why", "tight rows", "--name", "rows");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  assert.equal(tellsIn(env, "make", "a ward handover", "--kind", "list", "--variants", "2", "--out", out, "--dry-run").status, 0);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "reference-1.png")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /`reference-1\.png`: rows\. Why it's good: tight rows/);
  }
  assert.equal(tellsIn(env, "make", "a ward handover", "--kind", "forecast", "--out", out, "--dry-run").status, 2);
});

test("make --reference builds from a study and keeps the rebuild out of the pick", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "tide alerts for a harbour town", "--reference", icon, "--variants", "3", "--out", out, "--agent", agent, "--no-render");
  assert.equal(r.status, 0, r.stderr);
  const report = readFileSync(path.join(out, "REPORT.md"), "utf8");
  assert.match(report, /Winner: \*\*v2\*\*/);
  assert.match(report, /## References\n\n- `reference-1\.png`: icon-dark/);
  for (const v of ["v1", "v2", "v3"]) {
    assert.ok(!existsSync(path.join(out, v, "study.html")));
    assert.ok(existsSync(path.join(out, v, "shots", "study.html")));
  }
  assert.match(readFileSync(path.join(out, "v2", "shots", "study.html"), "utf8"), /999px/, "fix leaves the study alone");
});

test("variants rotate through the references as their main one", () => {
  const refs = [{ name: "a" }, { name: "b" }];
  const mains = studyPrompts("a ward handover", 3, refs).map((p) => /main reference is `reference-(\d)\.png`/.exec(p)[1]);
  assert.deepEqual(mains, ["1", "2", "1"]);
  const [solo] = studyPrompts("a ward handover", 1, [{ name: "a" }]);
  assert.doesNotMatch(solo, /other variants study the others/);
});

test("a landing brief gets the landing study, and no placeholder survives either prompt", () => {
  assert.ok(isLanding("the landing page for a Warzone league"));
  assert.ok(isLanding("an official website for a tournament hub"));
  assert.ok(!isLanding("a prescription queue for a hospital pharmacy"));
  const refs = [{ name: "a" }, { name: "b" }];
  const [landing] = studyPrompts("x", 2, refs, { page: "landing" });
  const [product] = studyPrompts("x", 2, refs);
  assert.match(landing, /The pacing/);
  assert.match(landing, /make the art yourself in inline SVG/);
  assert.doesNotMatch(product, /The pacing/);
  const [withAssets] = studyPrompts("x", 2, refs, { page: "landing", assets: true });
  assert.match(withAssets, /Use the files in `assets\/`/);
  for (const p of [landing, product, withAssets]) assert.doesNotMatch(p, /\{\{\w+\}\}/);
});

test("make --page and --assets reach every variant", () => {
  const assets = mkdtempSync(path.join(tmpdir(), "tells-assets-"));
  writeFileSync(path.join(assets, "logo.svg"), "<svg/>");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "a ward handover", "--reference", icon, "--page", "landing", "--assets", assets, "--variants", "2", "--out", out, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "assets", "logo.svg")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /This is a landing page/);
  }
  assert.equal(tells("make", "x", "--reference", icon, "--page", "poster", "--out", out, "--dry-run").status, 2);
});

test("make --current hands every variant the page it's redesigning", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "a releases dashboard for a DJ", "--reference", icon, "--current", icon, "--variants", "2", "--out", out, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "current.png")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /`current\.png` in this folder is that page as it is now/);
  }
  const [plain] = studyPrompts("x", 1, [{ name: "a" }]);
  assert.doesNotMatch(plain, /redesigning|\{\{current\}\}/);
});

test("--style takes the look from the reference; without it the palette comes from the subject", () => {
  const refs = [{ name: "a" }];
  const [styled] = studyPrompts("x", 1, refs, { style: true });
  const [plain] = studyPrompts("x", 1, refs);
  assert.match(styled, /The look comes from the main reference too/);
  assert.match(styled, /The rule set still wins/);
  assert.match(plain, /Choose the palette and the theme/);
  for (const p of [styled, plain]) assert.doesNotMatch(p, /\{\{\w+\}\}/);
  const [cur] = studyPrompts("x", 1, refs, { current: "current.png" });
  assert.match(cur, /Never invent names, numbers, tracks or rows/);
});
