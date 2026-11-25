#!/usr/bin/env node
// Rewrites the rule tables in README.md between the <!-- rules:<command> --> markers, and the rule count in each table's summary.
import fs from "node:fs";
import { RULES as CHECK } from "../src/check.mjs";
import { RULES as RENDER } from "../src/render.mjs";
import { FIXABLE } from "../src/fix.mjs";
import { RULES as SAME } from "../src/same.mjs";
import { RULES as CONSISTENT } from "../src/consistent.mjs";
import { RULES as CLICK } from "../src/click.mjs";

const cell = (s) => s.replace(/\|/g, "\\|");
const table = (rules, auto) =>
  auto
    ? ["| Rule | Severity | Category | `tells fix` | Fix |", "|---|---|---|---|---|", ...rules.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.category} | ${FIXABLE.includes(r.id) ? "yes" : ""} | ${cell(r.fix)} |`)].join("\n")
    : rules[0].category
      ? ["| Rule | Severity | Category | Fix |", "|---|---|---|---|", ...rules.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.category} | ${cell(r.fix)} |`)].join("\n")
      : ["| Rule | Severity | Fix |", "|---|---|---|", ...rules.map((r) => `| \`${r.id}\` | ${r.severity} | ${cell(r.fix)} |`)].join("\n");

const file = new URL("../README.md", import.meta.url);
let md = fs.readFileSync(file, "utf8");
for (const [key, rules] of [["check", CHECK], ["render", RENDER], ["same", SAME], ["consistent", CONSISTENT], ["click", CLICK]]) {
  const re = new RegExp(`(<!-- rules:${key} -->)[\\s\\S]*?(<!-- /rules:${key} -->)`);
  if (!re.test(md)) throw new Error(`README is missing the rules:${key} markers`);
  md = md.replace(re, `$1\n${table(rules, key === "check")}\n$2`);
  md = md.replace(new RegExp(`(<b><code>tells ${key}</code></b>: )\\d+( rules?)`), `$1${rules.length}$2`);
}
if (process.argv.includes("--check")) {
  if (md !== fs.readFileSync(file, "utf8")) {
    console.error("README rule tables are out of date. Run: npm run docs:rules");
    process.exit(1);
  }
} else fs.writeFileSync(file, md);
