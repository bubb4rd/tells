// Stand-in for an agent in tests: reads the prompt on stdin and writes the matching pick fixture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const prompt = fs.readFileSync(0, "utf8");
const k = Number(/variant (\d+) of \d+/.exec(prompt)?.[1]);
const pick = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pick");
const from = { 1: "rough", 2: "clean", 3: "excused" }[k];
if (!from) process.exit(1);
fs.copyFileSync(path.join(pick, from, "index.html"), "index.html");
fs.writeFileSync("NOTES.md", `Variant ${k}, copied from the ${from} fixture.\n`);
