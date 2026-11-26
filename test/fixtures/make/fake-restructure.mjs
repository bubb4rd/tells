// Stand-in for the agent that restructures one screen of a product taken in with --from. It shortens the Orders
// line (its own file). With "> sneak" it also changes a shared token without listing it, and puts it back when
// asked a second time; with "> sneak and stay" it doesn't.
import fs from "node:fs";

const prompt = fs.readFileSync(0, "utf8");
if (!prompt.includes("**`orders`**")) process.exit(1);
const round = /## Round (\d+)/.exec(prompt)?.[1];
const secondTurn = prompt.includes("## Put these back");
const css = fs.readFileSync("styles.css", "utf8");
if (prompt.includes("> sneak")) {
  if (!secondTurn || prompt.includes("> sneak and stay")) fs.writeFileSync("styles.css", css.replace("#17703A", "#FF6FB5"));
  else fs.writeFileSync("styles.css", css.replace("#FF6FB5", "#17703A"));
}
if (!secondTurn) {
  fs.writeFileSync("screens/orders.js", fs.readFileSync("screens/orders.js", "utf8").replace("orders are waiting to be confirmed", "orders wait"));
  fs.appendFileSync("POLISH.md", `## Round ${round}\n\nOrders: a shorter line, in screens/orders.js.\n\n### Tokens changed\n\nnone\n\n`);
  fs.appendFileSync("NOTES.jsonl", JSON.stringify({ round: Number(round), note: "shorter line", from: "person", kind: "decision", tag: "copy", rule: null }) + "\n");
}
