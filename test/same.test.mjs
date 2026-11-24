import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RULES } from "../src/same.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const dir = path.join(here, "fixtures", "same");

const same = (...args) => {
  const r = spawnSync(process.execPath, [bin, "same", ...args, "--json"], { encoding: "utf8" });
  return { code: r.status, designs: JSON.parse(r.stdout).designs };
};
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
