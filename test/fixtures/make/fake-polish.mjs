// Stand-in for the agent that polishes a built product: answers the notes, asks for a deletion and an exception.
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("> the tabs sit too high")) process.exit(1);
const round = /## Round (\d+)/.exec(prompt)?.[1];
fs.appendFileSync("POLISH.md", `## Round ${round}\n\nThe tabs: centred in system/ui.css.\n`);
fs.appendFileSync("NOTES.jsonl", [
  { round: Number(round), note: "the tabs sit too high", from: "person", kind: "defect", tag: "label-alignment", rule: "off-centre-label" },
  { round: Number(round), note: "a count touches its border", from: "found", kind: "defect", tag: "label-alignment", rule: null },
].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
fs.writeFileSync("DELETE.txt", "screens/old.css\n../outside.txt\n");
fs.writeFileSync(".tellsrc", JSON.stringify({ allow: { "small-tap-target": "laptop only" } }));
