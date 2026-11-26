#!/usr/bin/env node
// When each agent of a `tells make --product` run actually worked, what it did, what it cost, and the gaps
// between agents (your reading and notes, and tells' own checks).
//
//   node scripts/make-timeline.mjs <run folder>            writes <run>/timeline.json and prints a summary
//   node scripts/make-timeline.mjs <run folder> --json     prints the JSON instead
//
// Reads <run>/agents/*.jsonl (one stamped stream per agent, written by runAgent). Runs from a custom --agent
// have no stream: they come from product.json with start and end only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { usageOf } from "../src/make.mjs";

const GAP_MS = 3 * 60_000; // shorter gaps between agents are tells checking (fix, measure, audit), not you

const detailOf = (name, input = {}) =>
  name === "Bash" ? String(input.command ?? "").replace(/\s+/g, " ").slice(0, 80)
    : input.file_path ?? input.path ?? input.pattern ?? "";

/** One agent's stream: start, end, each tool call, and the usage from its result (if it got that far). */
export function readStream(file) {
  const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const stamped = events.filter((e) => typeof e.at === "number");
  const tools = stamped.flatMap((e) =>
    e.type === "assistant"
      ? (e.message?.content ?? []).filter((c) => c.type === "tool_use").map((c) => ({ at: e.at, name: c.name, detail: detailOf(c.name, c.input) }))
      : [],
  );
  const result = events.find((e) => e.type === "result");
  return {
    label: path.basename(file, ".jsonl"),
    start: stamped[0]?.at ?? null,
    end: stamped.at(-1)?.at ?? null,
    finished: Boolean(result),
    ...(result ? usageOf(result) : {}),
    tools,
  };
}

/** Every agent run recorded in product.json, flattened, with the label its stream is kept under. */
function recordedRuns(state) {
  const list = [];
  const add = (label, r) => r?.started && list.push({ label, start: Date.parse(r.started), end: Date.parse(r.ended), ok: r.ok });
  if (state.ingest?.run) add("ingest", state.ingest.run);
  for (const [k, r] of Object.entries(state.runs ?? {})) add(/^v\d+$/.test(k) ? `system-${k}` : k === "review" ? "review" : `screen-${k}`, r);
  const seen = {};
  for (const r of state.revisions ?? []) add(`revise-${r.v}-${(seen[r.v] = (seen[r.v] ?? 0) + 1)}`, r.run);
  (state.polishes ?? []).forEach((p, i) => {
    const n = i + 1;
    if (p.run?.runs) for (const [id, r] of Object.entries(p.run.runs)) add(`round-${n}-${id}`, r);
    else add(`round-${n}`, p.run);
    add(`round-${n}-again`, p.again);
  });
  return list;
}

export function timeline(out) {
  const state = JSON.parse(fs.readFileSync(path.join(out, "product.json"), "utf8"));
  const dir = path.join(out, "agents");
  const streams = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => readStream(path.join(dir, f))).filter((a) => a.start)
    : [];
  const byLabel = new Map(streams.map((a) => [a.label, a]));
  // Runs without a stream (a custom --agent) still have their start and end.
  for (const r of recordedRuns(state)) {
    const a = byLabel.get(r.label);
    if (a) Object.assign(a, { start: r.start, end: r.end }); // the process's own start and end, not its first and last event
    else byLabel.set(r.label, { label: r.label, start: r.start, end: r.end, finished: r.ok, tools: [], streamed: false });
  }
  const agents = [...byLabel.values()].sort((a, b) => a.start - b.start);

  // Gaps where no agent was running: you reading, writing notes, approving; or tells checking between stages.
  const waits = [];
  let reach = agents[0]?.start ?? 0;
  let busy = 0;
  for (const a of agents) {
    if (a.start - reach > GAP_MS) waits.push({ from: reach, to: a.start, minutes: Math.round((a.start - reach) / 60_000), before: a.label });
    // Longest path: wall clock with an agent running, overlaps counted once.
    busy += Math.max(0, a.end - Math.max(a.start, reach));
    reach = Math.max(reach, a.end);
  }
  const first = agents[0]?.start ?? null;
  const last = agents.length ? reach : null;
  const cost = agents.reduce((s, a) => s + (a.costUsd ?? 0), 0);
  return {
    brief: state.brief,
    start: first,
    end: last,
    wallMinutes: first == null ? 0 : Math.round((last - first) / 60_000),
    agentPathMinutes: Math.round(busy / 60_000),
    agentMinutes: Math.round(agents.reduce((s, a) => s + (a.end - a.start), 0) / 60_000),
    costUsd: Math.round(cost * 100) / 100,
    agents,
    waits,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out || !fs.existsSync(path.join(out, "product.json"))) {
    console.error("Usage: node scripts/make-timeline.mjs <tells make --product run folder>");
    process.exit(2);
  }
  const t = timeline(path.resolve(out));
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(t, null, 2) + "\n");
  } else {
    fs.writeFileSync(path.join(out, "timeline.json"), JSON.stringify(t, null, 2) + "\n");
    const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
    console.log(`${t.brief}\n${t.wallMinutes}m wall clock, ${t.agentPathMinutes}m with an agent running, ${t.agentMinutes}m agent time, $${t.costUsd.toFixed(2)}`);
    for (const a of t.agents) {
      const mins = Math.round((a.end - a.start) / 60_000);
      console.log(`  ${clock(a.start)}–${clock(a.end)}  ${a.label.padEnd(22)} ${String(mins).padStart(3)}m  ${a.tools.length} tool calls${a.costUsd != null ? `  $${a.costUsd.toFixed(2)}` : ""}${a.finished ? "" : "  (no result)"}`);
    }
    for (const w of t.waits) console.log(`  wait ${clock(w.from)}–${clock(w.to)}  ${w.minutes}m before ${w.before}`);
    console.log(`Wrote ${path.join(out, "timeline.json")}`);
  }
}
