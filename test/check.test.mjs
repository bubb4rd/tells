import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OTHER_TOOL_RULES } from "../src/check.mjs";
import { RULES as RENDER_RULES } from "../src/render.mjs";
import { RULES as SAME_RULES } from "../src/same.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const fixtures = path.join(here, "fixtures");

function check(...args) {
  const r = spawnSync(process.execPath, [bin, "check", "--json", ...args], { encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout) };
}

const ruleIds = spawnSync(process.execPath, [bin, "rules", "check"], { encoding: "utf8" })
  .stdout.trim().split("\n").map((l) => l.split(/\s+/)[0]);

test("every check rule has a fixture", () => {
  const have = readdirSync(path.join(fixtures, "check")).map((f) => f.replace(/\.html$/, ""));
  assert.deepEqual([...have].sort(), [...ruleIds].sort());
});

for (const id of ruleIds) {
  test(`${id} fires on its fixture`, () => {
    const { out } = check(path.join(fixtures, "check", `${id}.html`));
    assert.ok(out.hits.some((h) => h.rule === id), `expected ${id}, got ${out.hits.map((h) => h.rule).join(", ") || "nothing"}`);
  });
}

test("clean page has no hits and exits 0", () => {
  const { code, out } = check(path.join(fixtures, "clean"));
  assert.deepEqual(out.hits, []);
  assert.equal(code, 0);
});

test("errors exit 1", () => {
  assert.equal(check(path.join(fixtures, "check", "glass.html")).code, 1);
});

test("warnings exit 0, or 1 with --strict", () => {
  const file = path.join(fixtures, "check", "uppercase.html");
  assert.equal(check(file).code, 0);
  assert.equal(check("--strict", file).code, 1);
});

test("tells-ok and slop-ok both allow a hit with a reason", () => {
  const { code, out } = check(path.join(fixtures, "suppressed.html"));
  assert.deepEqual(out.hits, []);
  assert.deepEqual(out.allowed.map((a) => a.rule).sort(), ["dot-triplet", "glass"]);
  assert.equal(code, 0);
});

test("tells-ok for render and same rules is accepted by check, and rule lists stay in sync", () => {
  const expected = [...RENDER_RULES, ...SAME_RULES].map((r) => r.id).sort();
  assert.deepEqual([...OTHER_TOOL_RULES].sort(), expected);
  const { out: sameFile } = check(path.join(fixtures, "same", "copy", "two", "tokens.css"));
  assert.ok(!sameFile.hits.some((h) => h.rule === "ok-unknown"), `unexpected ok-unknown: ${JSON.stringify(sameFile.hits)}`);
  const { out: renderFile } = check(path.join(fixtures, "render-ok", "suppressed.html"));
  assert.ok(!renderFile.hits.some((h) => h.rule === "ok-unknown"), `unexpected ok-unknown: ${JSON.stringify(renderFile.hits)}`);
  assert.ok(renderFile.hits.some((h) => h.rule === "ok-reason"), "bare tells-ok on render rule should still flag ok-reason");
});

test("an eyebrow class and a fake countdown are caught however they're styled", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tells-check-"));
  const file = path.join(dir, "league.html");
  writeFileSync(file, `<p class="eyebrow">Season 04</p>\n<h2>Standings</h2>\n<svg><text x="0" y="10">00:42 to close</text></svg>\n<div class="kicker-small">Week 9</div>\n`);
  const { out } = check(file);
  const lines = (rule) => out.hits.filter((h) => h.rule === rule).map((h) => h.line);
  assert.deepEqual(lines("eyebrow-copy"), [1, 4]);
  assert.deepEqual(lines("status-theatre"), [3]);
});
