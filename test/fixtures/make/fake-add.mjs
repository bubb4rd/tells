// Stand-in for the agent of --add: builds the Roasts screen the house way (its own file, a script tag, a nav link).
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("**`roasts`**")) process.exit(1);
const round = /## Round (\d+)/.exec(prompt)?.[1];
fs.writeFileSync("screens/roasts.js", "window.Screens.roasts = (v) => { v.innerHTML = `<h1>Roasts</h1><p>Three batches on the drum this week.</p>`; };\n");
const html = fs.readFileSync("index.html", "utf8")
  .replace('<a href="#/later">Later</a>', '<a href="#/roasts">Roasts</a><a href="#/later">Later</a>')
  .replace('<script src="app.js"></script>', '<script src="screens/roasts.js"></script>\n<script src="app.js"></script>');
fs.writeFileSync("index.html", html);
fs.appendFileSync("POLISH.md", `## Round ${round}\n\nRoasts: the week's batches.\n\n### Tokens changed\n\nnone\n\n`);
