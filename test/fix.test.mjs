import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FIXABLE } from "../src/fix.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const fixtures = path.join(here, "fixtures");

const tells = (...args) => {
  const r = spawnSync(process.execPath, [bin, ...args, "--json"], { encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout) };
};
const scratch = () => mkdtempSync(path.join(tmpdir(), "tells-fix-"));
const copy = (from) => {
  const to = path.join(scratch(), path.basename(from));
  cpSync(from, to, { recursive: true });
  return to;
};
const write = (name, body) => {
  const file = path.join(scratch(), name);
  writeFileSync(file, body);
  return file;
};

for (const id of FIXABLE) {
  test(`fix clears ${id} on its fixture`, () => {
    const file = copy(path.join(fixtures, "check", `${id}.html`));
    const { out } = tells("fix", file);
    assert.ok(out.fixed.some((c) => c.rule === id), `expected a ${id} fix`);
    assert.ok(!tells("check", file).out.hits.some((h) => h.rule === id), `${id} still fires`);
  });
}

test("fix leaves clean and allowed files byte for byte", () => {
  for (const src of [path.join(fixtures, "clean", "index.html"), path.join(fixtures, "suppressed.html")]) {
    const file = copy(src);
    const { out } = tells("fix", file);
    assert.deepEqual(out.fixed, []);
    assert.equal(readFileSync(file, "utf8"), readFileSync(src, "utf8"));
  }
});

test("fix is idempotent", () => {
  const dir = path.join(scratch(), "check");
  cpSync(path.join(fixtures, "check"), dir, { recursive: true });
  tells("fix", dir);
  assert.deepEqual(tells("fix", dir).out.fixed, []);
});

test("--dry-run reports and writes nothing", () => {
  const file = copy(path.join(fixtures, "check", "pill-radius.html"));
  const before = readFileSync(file, "utf8");
  const { out } = tells("fix", "--dry-run", file);
  assert.equal(out.fixed.length, 1);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("exit code reflects what's left after fixing", () => {
  assert.equal(tells("fix", copy(path.join(fixtures, "check", "pill-radius.html"))).code, 0);
  assert.equal(tells("fix", copy(path.join(fixtures, "check", "glass.html"))).code, 1);
});

test("transition-all names what the element changes", () => {
  const file = write(
    "Panel.tsx",
    [
      "export const Panel = ({ open, w }) => (",
      '  <div className="transition-all duration-200" style={{ maxWidth: w }}>',
      "    <div",
      "      className={`transition-all ${",
      '        open ? "rounded-lg bg-mat" : "rounded-none"',
      "      }`}",
      "    />",
      "  </div>",
      ");",
    ].join("\n"),
  );
  tells("fix", file);
  const src = readFileSync(file, "utf8");
  assert.match(src, /transition-\[[^\]]*max-width[^\]]*\] duration-200/);
  assert.match(src, /transition-\[[^\]]*border-radius[^\]]*\] \$\{/);
});

test("transition: all in CSS keeps what state rules change", () => {
  const file = write("a.css", ".btn { background: var(--bg); transition: all 200ms ease; }\n.btn:hover { --bg: #eee; padding-inline: 20px; cursor: pointer; }\n");
  tells("fix", file);
  const line = readFileSync(file, "utf8").split("\n")[0];
  assert.match(line, /background 200ms ease/);
  assert.match(line, /padding-inline 200ms ease/);
  assert.doesNotMatch(line, /cursor|\ball\b/);
});

test("pill fix keeps square corners and leaves circles alone", () => {
  const file = write("b.css", ".tab { border-radius: 9999px 9999px 0 0; }\n.dot { width: 8px; height: 8px; border-radius: 999px; }\n");
  tells("fix", file);
  assert.equal(readFileSync(file, "utf8"), ".tab { border-radius: 6px 6px 0 0; }\n.dot { width: 8px; height: 8px; border-radius: 999px; }\n");
});
