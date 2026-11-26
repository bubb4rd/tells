// Stands in for `claude -p --output-format stream-json`: reads the prompt, prints canned events.
// FAKE_CLAUDE=no-result prints a tool call and exits 1 without a result, as a crash or timeout would.
// FAKE_CLAUDE=unterminated leaves the result line without a trailing newline.
import fs from "node:fs";

fs.readFileSync(0, "utf8");
const mode = process.env.FAKE_CLAUDE ?? "";
const say = (e) => process.stdout.write(JSON.stringify(e) + "\n");
say({ type: "system", subtype: "init", session_id: "s1", tools: ["Read", "Write", "Bash"] });
say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "node bin/tells.mjs render index.html --strict" } }] } });
say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "0 errors" }] } });
process.stdout.write("not json, a stray line\n");
say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Write", input: { file_path: "index.html", content: "<!doctype html>" } }] } });
if (mode === "no-result") process.exit(1);
const result = JSON.stringify({
  type: "result", subtype: "success", is_error: false, result: "Built index.html.", num_turns: 4, duration_api_ms: 1234,
  total_cost_usd: 0.42, credential_expires_at: "2026-11-27T19:26:36.368Z",
  usage: { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 90000, cache_creation_input_tokens: 30000 },
});
process.stdout.write(mode === "unterminated" ? result : result + "\n");
