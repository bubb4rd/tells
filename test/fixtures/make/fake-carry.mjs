// Stand-in for the agents of --carry: the first writes PATTERN.md; each target screen's agent then re-lays it.
// The stock agent also edits a shared file in its copy, which must not come back.
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
const round = /## Round (\d+)/.exec(prompt)?.[1];
if (prompt.includes("write the pattern down")) {
  fs.writeFileSync("PATTERN.md", "# Pattern\n\nRules between blocks, no cards.\n");
  fs.appendFileSync("POLISH.md", `## Round ${round}\n\nLifted .orders rules into .ruled.\n\n### Tokens changed\n\nnone\n\n`);
} else if (prompt.includes("**`stock`**")) {
  fs.writeFileSync("screens/stock.js", fs.readFileSync("screens/stock.js", "utf8").replace("bags on the shelf", "bags on the shelf, ruled"));
  fs.writeFileSync("styles.css", fs.readFileSync("styles.css", "utf8").replace("#17703A", "#000000"));
} else if (prompt.includes("**`home`**")) {
  fs.writeFileSync("app.js", fs.readFileSync("app.js", "utf8").replace("Two orders ship today.", "Two orders ship today, ruled."));
} else process.exit(1);
