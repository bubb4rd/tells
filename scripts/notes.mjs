#!/usr/bin/env node
// The notes ledger across products: what people had to point out, round by round, and which kinds of thing
// came back in more than one product (the candidates for a tells rule).
//
//   npm run notes                                    docs/notes-ledger.jsonl
//   npm run notes -- docs/notes-ledger.jsonl <run>/product/NOTES.jsonl …
//
// A product's NOTES.jsonl (written by `tells make --revise product`) is named after its run folder.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger } from "../src/product.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(root, "docs", "notes-ledger.jsonl")];

const entries = files.flatMap((f) => {
  const fallback = path.basename(path.dirname(path.dirname(path.resolve(f))));
  return readLedger(f).map((e) => ({ ...e, product: e.product || fallback }));
});
if (!entries.length) {
  console.error(`No notes in ${files.join(", ")}.`);
  process.exit(1);
}

const by = (list, key) => list.reduce((m, e) => m.set(e[key], [...(m.get(e[key]) ?? []), e]), new Map());
const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

// 1. Each product, round by round. Defects should fall as tells learns; decisions are the person's to make.
for (const [product, list] of by(entries, "product")) {
  console.log(product);
  for (const [round, inRound] of [...by(list, "round")].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const person = inRound.filter((e) => e.from !== "found");
    const defects = person.filter((e) => e.kind === "defect");
    const found = inRound.filter((e) => e.from === "found");
    const stage = inRound[0].stage ? ` (${inRound[0].stage})` : "";
    console.log(`  round ${round}${stage}: ${n(defects.length, "defect")}, ${n(person.length - defects.length, "decision")}; found ${found.length} more`);
  }
}

// 2. Kinds of defect, by how many products they turned up in. Two or more, and no rule yet: write one.
const defects = entries.filter((e) => e.kind === "defect" && e.tag);
const kinds = [...by(defects, "tag")].map(([tag, list]) => ({
  tag,
  products: [...new Set(list.map((e) => e.product))],
  count: list.length,
  rule: list.find((e) => e.rule)?.rule ?? null,
}));
kinds.sort((a, b) => b.products.length - a.products.length || b.count - a.count || a.tag.localeCompare(b.tag));

const recurring = kinds.filter((k) => k.products.length > 1);
console.log("\nCame back in more than one product:");
if (!recurring.length) console.log("  none yet");
for (const k of recurring) console.log(`  ${k.tag.padEnd(22)} ${k.products.join(", ")}  ${k.rule ? `rule: ${k.rule}` : "no rule yet: candidate"}`);

const uncaught = kinds.filter((k) => !k.rule && k.products.length === 1);
console.log("\nDefects no rule flags yet (one product so far):");
if (!uncaught.length) console.log("  none");
for (const k of uncaught) console.log(`  ${k.tag.padEnd(22)} ${k.products[0]}${k.count > 1 ? `, ${k.count} times` : ""}`);
