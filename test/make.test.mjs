import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ANGLES, prompts } from "../src/make.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const pick = path.join(here, "fixtures", "pick");
const agent = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-agent.mjs")}"`;
const tells = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

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
