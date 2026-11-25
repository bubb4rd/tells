import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "../src/consistent.mjs";
import { parseScreens, owned, systemPrompts, screenPrompt } from "../src/product.mjs";

const base = { families: ["apfel"], h1: 30, h2: 16, page: [231, 229, 223], panel: { radius: 4, bg: "#f3f2ee", border: "#d2cfc6" }, marks: ["dots"], layout: "sidebar-main", accents: [5] };
const screen = (label, over = {}) => ({ label, traits: { ...base, ...over } });

test("screens that share the system pass, each drawn in its own shape", () => {
  const { hits } = compare([screen("a"), screen("b", { marks: ["lines", "dots"] }), screen("c", { marks: ["bars"] })]);
  assert.deepEqual(hits, []);
});

test("a product that draws every screen with the same one mark is one-shape; leads are spared", () => {
  const { hits } = compare([screen("lead1"), screen("lead2"), screen("x"), screen("y")], ["lead1", "lead2"]);
  assert.deepEqual(hits.map((h) => `${h.target} ${h.rule}`), ["x one-shape", "y one-shape"]);
  assert.equal(hits[0].severity, "warn");
  assert.deepEqual(compare([screen("a"), screen("b")]).hits, []);
});

test("a stitched screen drifts on page, panel, font and shell; a different mark is not drift", () => {
  const odd = screen("odd", {
    families: ["apfel", "inter"],
    page: [236, 235, 230],
    panel: { radius: 12, bg: "#f6f5f1", border: "#d2cfc6" },
    marks: ["lines"],
    layout: "top-nav-workspace",
    h1: 44,
  });
  const { hits } = compare([screen("a"), screen("b"), odd]);
  assert.deepEqual(hits.filter((h) => h.target === "odd").map((h) => h.rule).sort(), ["drift-heading", "drift-page", "drift-panel", "drift-shell", "drift-typeface"]);
  assert.ok(!hits.some((h) => h.target !== "odd"));
});

test("--lead screens define the system even when they're outnumbered", () => {
  const other = { page: [255, 255, 255], families: ["inter"] };
  const { system, hits } = compare([screen("lead1"), screen("lead2"), screen("x", other), screen("y", other), screen("z", other)], ["lead1", "lead2"]);
  assert.deepEqual(system.families, ["apfel"]);
  assert.deepEqual([...new Set(hits.map((h) => h.target))].sort(), ["x", "y", "z"]);
});

test("--screens parses ids and jobs; the first two are the leads", () => {
  const s = parseScreens("today: what to roast and ship today; orders: wholesale orders ;inventory: green and roasted stock");
  assert.deepEqual(s.map((x) => x.id), ["today", "orders", "inventory"]);
  assert.equal(s[1].job, "wholesale orders");
  assert.throws(() => parseScreens("a: x; a: y"), /twice/);
});

test("prompts name the leads, the screen's own files, and the tells repo", () => {
  const state = { brief: "a roaster's back office", screens: parseScreens("today: t; orders: o; stock: s"), refs: [], style: false, assets: null };
  const [sys] = systemPrompts(state, 1);
  assert.match(sys, /screens\/today\.html/);
  assert.match(sys, /screens\/orders\.html/);
  assert.doesNotMatch(sys, /\{\{\w+\}\}/);
  const scr = screenPrompt(state, state.screens[2]);
  assert.match(scr, /screens\/stock\.html/);
  assert.doesNotMatch(scr, /\{\{\w+\}\}/);
  assert.deepEqual(owned("stock").filter((f) => f.startsWith("data/")), ["data/stock.js"]);
});

test("an agent's .tellsrc keeps its shortcuts; its allow is set aside for the person", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = (await import("node:path")).default;
  const { quarantineAllow } = await import("../src/product.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "tells-q-"));
  writeFileSync(path.join(dir, ".tellsrc"), JSON.stringify({ shortcuts: ["⌘K"], allow: { "small-tap-target": "laptop only" } }));
  assert.deepEqual(quarantineAllow(dir), { "small-tap-target": "laptop only" });
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, ".tellsrc"), "utf8")), { shortcuts: ["⌘K"] });
  assert.ok(existsSync(path.join(dir, ".tellsrc.proposed")));
  assert.equal(quarantineAllow(dir), null);
});
