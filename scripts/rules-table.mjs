#!/usr/bin/env node
// Rewrites the rule tables in README.md between the <!-- rules:check --> / <!-- rules:render --> markers.
import fs from "node:fs";
import { RULES as CHECK } from "../src/check.mjs";
import { RULES as RENDER } from "../src/render.mjs";

const table = (rules) =>
  ["| Rule | Severity | Category | Fix |", "|---|---|---|---|", ...rules.map((r) => `| \`${r.id}\` | ${r.severity} | ${r.category} | ${r.fix.replace(/\|/g, "\\|")} |`)].join("\n");

const file = new URL("../README.md", import.meta.url);
let md = fs.readFileSync(file, "utf8");
for (const [key, rules] of [["check", CHECK], ["render", RENDER]]) {
  const re = new RegExp(`(<!-- rules:${key} -->)[\\s\\S]*?(<!-- /rules:${key} -->)`);
  if (!re.test(md)) throw new Error(`README is missing the rules:${key} markers`);
  md = md.replace(re, `$1\n${table(rules)}\n$2`);
}
if (process.argv.includes("--check")) {
  if (md !== fs.readFileSync(file, "utf8")) {
    console.error("README rule tables are out of date. Run: npm run docs:rules");
    process.exit(1);
  }
} else fs.writeFileSync(file, md);
