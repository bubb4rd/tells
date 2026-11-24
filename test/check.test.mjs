import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
