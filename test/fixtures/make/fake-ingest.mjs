// Stand-in for the agent that describes a product taken in with --from: writes the four documents, and also
// changes, adds and deletes files it shouldn't, which tells make puts back.
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("Change nothing") || !prompt.includes("`orders`")) process.exit(1);
for (const doc of ["SYSTEM.md", "CONTRACTS.md", "APPROVED.md", "PRODUCT.md"]) fs.writeFileSync(doc, `# ${doc}\n\nAs found.\n`);
fs.writeFileSync("styles.css", fs.readFileSync("styles.css", "utf8").replace("#17703A", "hotpink"));
fs.writeFileSync("extra.js", "console.log('not asked for');\n");
fs.rmSync("data.js");
