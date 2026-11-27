// Stands in for every agent of a `tells make --product` run, told apart by its prompt.
// System: v1 builds clean lead screens; v2's have a "Learn more" button (a check error `tells fix` leaves).
// Fix: puts a real action in its place (FAKE_FIX=none: changes nothing). Screen: builds its page and writes down what it was given.
import fs from "node:fs";
import path from "node:path";

const prompt = fs.readFileSync(0, "utf8");
const v = path.basename(process.cwd());
const page = (title, action) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="../system/ui.css"></head>
<body><main><h1>${title}</h1><p>Two orders ship today: Ritual Coffee, 12 kg, and Blue Door, 6 kg.</p>
<button type="button" onclick="this.textContent='Packed'">${action}</button></main></body></html>
`;
const write = (f, text) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const leads = [...prompt.matchAll(/`screens\/([a-z]+)\.html`/g)].map((m) => m[1]);

if (prompt.startsWith("You built the system of this product and its two lead screens. tells checked them")) {
  if (process.env.FAKE_FIX === "none") process.exit(0); // a fix round that fixes nothing
  for (const f of fs.readdirSync("screens")) {
    const file = path.join("screens", f);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Learn more", "Pack the order"));
  }
  fs.writeFileSync("FIXES.md", `generic-cta: the lead screens' button now names its action.\n\nGiven:\n${prompt}`);
} else if (prompt.startsWith("You are building one screen")) {
  const id = /\*\*Your screen:\*\* `([a-z]+)`/.exec(prompt)[1];
  write(`screens/${id}.html`, page(id, "Pack the order"));
  let rc = null;
  try {
    rc = JSON.parse(fs.readFileSync(".tellsrc", "utf8"));
  } catch {}
  write(`screens/${id}.needs.md`, JSON.stringify({ files: fs.readdirSync(".").sort(), tellsrc: rc }));
} else if (/two lead screens|lead screens/.test(prompt) && !fs.existsSync("SYSTEM.md")) {
  write("system/ui.css", "body { font-family: system-ui, sans-serif; color: #1b1f24; background: #fff; margin: 24px; }\nbutton { font: inherit; padding: 6px 12px; border: 1px solid #1b1f24; background: #fff; border-radius: 4px; }\n");
  write("SYSTEM.md", "# System\n");
  write("CONTRACTS.md", "# Contracts\n");
  write("NOTES.md", "# Notes\n");
  write("CRITIQUE.md", "# Critique of the leads\n");
  write("STUDY.md", "# Study\n");
  for (const id of leads.slice(0, 2)) write(`screens/${id}.html`, page(id, v === "v2" ? "Learn more" : "Pack the order"));
  // An agent rewriting .tellsrc for its shortcuts, dropping the widths the pipeline put there.
  fs.writeFileSync(".tellsrc", JSON.stringify({ shortcuts: [] }));
}
