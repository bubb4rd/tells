// Stand-in for the agent that polishes a built product: answers the notes, asks for a deletion and an exception.
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("> the tabs sit too high")) process.exit(1);
const round = /## Round (\d+)/.exec(prompt)?.[1];
fs.appendFileSync("POLISH.md", `## Round ${round}\n\nThe tabs: centred in system/ui.css.\n`);
fs.writeFileSync("DELETE.txt", "screens/old.css\n../outside.txt\n");
fs.writeFileSync(".tellsrc", JSON.stringify({ allow: { "small-tap-target": "laptop only" } }));
