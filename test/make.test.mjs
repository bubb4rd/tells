import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ANGLES, costLine, isLanding, prompts, runAgent, studyPrompts } from "../src/make.mjs";
import { readStream, timeline } from "../scripts/make-timeline.mjs";
import { polishPrompt } from "../src/product.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "bin", "tells.mjs");
const pick = path.join(here, "fixtures", "pick");
const rhouse = path.join(here, "fixtures", "same-rendered", "house");
const chrome = process.env.CHROME_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find(existsSync);
const skipChrome = chrome ? false : "Chrome not found (set CHROME_PATH)";
const agent = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-agent.mjs")}"`;
const tells = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
const tellsIn = (env, ...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const icon = path.join(here, "..", "docs", "assets", "icon-dark.png");

test("pick ranks by errors, then written exceptions, and says why each loser lost", () => {
  const r = tells("pick", path.join(pick, "rough"), path.join(pick, "excused"), path.join(pick, "clean"), "--no-render", "--json");
  const { winner, ranking } = JSON.parse(r.stdout);
  assert.match(winner, /clean$/);
  assert.deepEqual(ranking.map((m) => path.basename(m.variant)), ["clean", "excused", "rough"]);
  assert.match(ranking[1].why, /1 written exception/);
  assert.match(ranking[2].why, /3 rules broken, against 0 .*check:pill-radius/);
  assert.equal(r.status, 0);
});

test("pick needs at least two variants", () => {
  assert.equal(tells("pick", path.join(pick, "clean")).status, 2);
});

test("every variant gets the brief and its own angle", () => {
  const ps = prompts("tide alerts for a harbour town", 4);
  assert.equal(new Set(ps).size, 4);
  ps.forEach((p, i) => {
    assert.match(p, /tide alerts for a harbour town/);
    assert.ok(p.includes(ANGLES[i]));
    assert.match(p, new RegExp(`variant ${i + 1} of 4`));
  });
});

test("--dry-run writes the prompts and runs nothing", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  assert.equal(tells("make", "a tide table", "--variants", "3", "--out", out, "--dry-run").status, 0);
  for (const v of ["v1", "v2", "v3"]) {
    assert.ok(existsSync(path.join(out, v, "PROMPT.md")));
    assert.ok(!existsSync(path.join(out, v, "index.html")));
  }
});

test("make builds, fixes, picks and reports with no input after the brief", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "tide alerts for a harbour town", "--variants", "3", "--out", out, "--agent", agent, "--no-render");
  assert.equal(r.status, 0, r.stderr);
  const report = readFileSync(path.join(out, "REPORT.md"), "utf8");
  assert.match(report, /Winner: \*\*v2\*\*/);
  assert.match(report, /\*\*v1:\*\* 1 rule broken, against 0 \(check:generic-cta\)/); // fix already took the pill and the arrow
  assert.match(report, /\*\*v3:\*\* 1 written exception/);
  assert.doesNotMatch(readFileSync(path.join(out, "v1", "index.html"), "utf8"), /999px|→/);
});

test("pick reuses render fingerprints to choose off-house tokenless variants", { skip: skipChrome }, () => {
  const r = tells("pick", path.join(rhouse, "match"), path.join(rhouse, "distinct"), "--house", path.join(rhouse, "a"), "--json");
  const { winner, ranking } = JSON.parse(r.stdout);
  assert.match(winner, /distinct$/);
  assert.equal(ranking[0].houseOf, 8);
  assert.ok(ranking[1].lands.includes("house-style"), `expected match to land on house-style, got ${JSON.stringify(ranking[1])}`);
  assert.equal(r.status, 0);
});

test("study prompts name every reference, carry no angle, and put the rule set above the reference", () => {
  const refs = [
    { name: "github-issues", url: "https://github.com/vercel/next.js/issues", why: "dense rows, quiet chrome" },
    { name: "plausible", url: null, why: null },
  ];
  const ps = studyPrompts("a shift handover for night nurses", 2, refs);
  assert.equal(ps.length, 2);
  for (const [i, p] of ps.entries()) {
    assert.match(p, /a shift handover for night nurses/);
    assert.match(p, new RegExp(`variant ${i + 1} of 2`));
    assert.match(p, /`reference-1\.png`: github-issues \(https:\/\/github\.com\/vercel\/next\.js\/issues\)\. Why it's good: dense rows, quiet chrome/);
    assert.match(p, /`reference-2\.png`: plausible\n/);
    assert.ok(!ANGLES.some((a) => p.includes(a)));
    assert.match(p, /The rule set wins over the reference[\s\S]*anti-slop\.md/);
    assert.match(p, /check index\.html --strict/);
  }
});

test("refs add, list and remove keep the library outside the repo", () => {
  const lib = mkdtempSync(path.join(tmpdir(), "tells-refs-"));
  const env = { TELLS_REFERENCES: lib };
  assert.equal(tellsIn(env, "refs", "add", icon, "--kind", "brand").status, 2, "a reference needs a reason");
  const add = tellsIn(env, "refs", "add", icon, "--kind", "brand", "--why", "one mark, no noise", "--name", "icon");
  assert.equal(add.status, 0, add.stderr);
  assert.ok(existsSync(path.join(lib, "icon.png")));
  const [entry] = JSON.parse(readFileSync(path.join(lib, "index.json"), "utf8"));
  assert.deepEqual({ ...entry, added: undefined }, { name: "icon", kind: "brand", why: "one mark, no noise", url: null, shot: "icon.png", added: undefined });
  assert.match(tellsIn(env, "refs").stdout, /brand\s+icon\s+one mark, no noise/);
  assert.equal(tellsIn(env, "refs", "remove", "icon").status, 0);
  assert.ok(!existsSync(path.join(lib, "icon.png")));
});

test("make --kind copies every library reference of that kind into each variant", () => {
  const lib = mkdtempSync(path.join(tmpdir(), "tells-refs-"));
  const env = { TELLS_REFERENCES: lib };
  tellsIn(env, "refs", "add", icon, "--kind", "list", "--why", "tight rows", "--name", "rows");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  assert.equal(tellsIn(env, "make", "a ward handover", "--kind", "list", "--variants", "2", "--out", out, "--dry-run").status, 0);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "reference-1.png")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /`reference-1\.png`: rows\. Why it's good: tight rows/);
  }
  assert.equal(tellsIn(env, "make", "a ward handover", "--kind", "forecast", "--out", out, "--dry-run").status, 2);
});

test("make --reference builds from a study and keeps the rebuild out of the pick", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "tide alerts for a harbour town", "--reference", icon, "--variants", "3", "--out", out, "--agent", agent, "--no-render");
  assert.equal(r.status, 0, r.stderr);
  const report = readFileSync(path.join(out, "REPORT.md"), "utf8");
  assert.match(report, /Winner: \*\*v2\*\*/);
  assert.match(report, /## References\n\n- `reference-1\.png`: icon-dark/);
  for (const v of ["v1", "v2", "v3"]) {
    assert.ok(!existsSync(path.join(out, v, "study.html")));
    assert.ok(existsSync(path.join(out, v, "shots", "study.html")));
  }
  assert.match(readFileSync(path.join(out, "v2", "shots", "study.html"), "utf8"), /999px/, "fix leaves the study alone");
});

test("variants rotate through the references as their main one", () => {
  const refs = [{ name: "a" }, { name: "b" }];
  const mains = studyPrompts("a ward handover", 3, refs).map((p) => /main reference is `reference-(\d)\.png`/.exec(p)[1]);
  assert.deepEqual(mains, ["1", "2", "1"]);
  const [solo] = studyPrompts("a ward handover", 1, [{ name: "a" }]);
  assert.doesNotMatch(solo, /other variants study the others/);
});

test("a landing brief gets the landing study, and no placeholder survives either prompt", () => {
  assert.ok(isLanding("the landing page for a Warzone league"));
  assert.ok(isLanding("an official website for a tournament hub"));
  assert.ok(!isLanding("a prescription queue for a hospital pharmacy"));
  const refs = [{ name: "a" }, { name: "b" }];
  const [landing] = studyPrompts("x", 2, refs, { page: "landing" });
  const [product] = studyPrompts("x", 2, refs);
  assert.match(landing, /The pacing/);
  assert.match(landing, /make the art yourself in inline SVG/);
  assert.doesNotMatch(product, /The pacing/);
  const [withAssets] = studyPrompts("x", 2, refs, { page: "landing", assets: true });
  assert.match(withAssets, /Use the files in `assets\/`/);
  for (const p of [landing, product, withAssets]) assert.doesNotMatch(p, /\{\{\w+\}\}/);
});

test("make --page and --assets reach every variant", () => {
  const assets = mkdtempSync(path.join(tmpdir(), "tells-assets-"));
  writeFileSync(path.join(assets, "logo.svg"), "<svg/>");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "a ward handover", "--reference", icon, "--page", "landing", "--assets", assets, "--variants", "2", "--out", out, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "assets", "logo.svg")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /This is a landing page/);
  }
  assert.equal(tells("make", "x", "--reference", icon, "--page", "poster", "--out", out, "--dry-run").status, 2);
});

test("make --current hands every variant the page it's redesigning", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-make-")), "run");
  const r = tells("make", "a releases dashboard for a DJ", "--reference", icon, "--current", icon, "--variants", "2", "--out", out, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  for (const v of ["v1", "v2"]) {
    assert.ok(existsSync(path.join(out, v, "current.png")));
    assert.match(readFileSync(path.join(out, v, "PROMPT.md"), "utf8"), /`current\.png` in this folder is that page as it is now/);
  }
  const [plain] = studyPrompts("x", 1, [{ name: "a" }]);
  assert.doesNotMatch(plain, /redesigning|\{\{current\}\}/);
});

test("--style takes the look from the reference; without it the palette comes from the subject", () => {
  const refs = [{ name: "a" }];
  const [styled] = studyPrompts("x", 1, refs, { style: true });
  const [plain] = studyPrompts("x", 1, refs);
  assert.match(styled, /The look comes from the main reference too/);
  assert.match(styled, /The rule set still wins/);
  assert.match(plain, /Choose the palette and the theme/);
  for (const p of [styled, plain]) assert.doesNotMatch(p, /\{\{\w+\}\}/);
  const [cur] = studyPrompts("x", 1, refs, { current: "current.png" });
  assert.match(cur, /Never invent names, numbers, tracks or rows/);
});

test("a built product goes back with --revise product: notes in, deletions and exceptions handled, report updated", { skip: skipChrome }, () => {
  const out = mkdtempSync(path.join(tmpdir(), "tells-polish-"));
  const product = path.join(out, "product");
  const page = (t) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title></head><body><main><h1>${t}</h1><p>Two orders ship today.</p></main></body></html>`;
  mkdirSync(path.join(product, "screens"), { recursive: true });
  for (const id of ["today", "orders", "stock"]) writeFileSync(path.join(product, "screens", `${id}.html`), page(id));
  writeFileSync(path.join(product, "screens", "old.css"), "a { color: red }\n");
  writeFileSync(path.join(out, "outside.txt"), "stays\n");
  const screens = [{ id: "today", job: "t" }, { id: "orders", job: "o" }, { id: "stock", job: "s" }];
  writeFileSync(path.join(out, "product.json"), JSON.stringify({ brief: "a roaster", screens, stage: "done", approved: "v1", runs: {}, built: {}, result: { before: "b", after: "a" } }));
  const polish = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-polish.mjs")}"`;

  const bad = tells("make", "--resume", out, "--revise", "v1", "--notes", "x");
  assert.equal(bad.status, 2);
  const r = tells("make", "--resume", out, "--revise", "product", "--notes", "the tabs sit too high", "--agent", polish);
  assert.match(r.stdout, /round 1/);
  assert.match(readFileSync(path.join(product, "POLISH.md"), "utf8"), /## Round 1/);
  assert.ok(!existsSync(path.join(product, "screens", "old.css")), "listed file inside the product is deleted");
  assert.ok(existsSync(path.join(out, "outside.txt")), "a path outside the product is never deleted");
  assert.ok(existsSync(path.join(product, ".tellsrc.proposed")), "an allow the agent wrote is set aside");
  const state = JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));
  assert.equal(state.polishes.length, 1);
  assert.deepEqual(state.polishes[0].deleted, ["screens/old.css"]);
  assert.match(readFileSync(path.join(out, "REPORT.md"), "utf8"), /After your notes, round 1: consistent.* · your notes: 1 defect, 0 decisions; found 1 more/);
  assert.deepEqual(state.polishes[0].ledger, { defects: 1, decisions: 0, found: 1 }, "a line that isn't JSON is skipped");
  assert.ok(existsSync(path.join(out, "POLISH-PROMPT-1.md")));
  assert.match(readFileSync(path.join(out, "REPORT.md"), "utf8"), /## What the agents cost\n\n- Notes, round 1: 1 agent, \d+s\n- All: 1 agent/, "a custom agent counts for time only");
  assert.ok(state.polishes[0].run.started, "each run keeps when it started, for the timeline");

  tells("make", "--resume", out, "--revise", "product", "--notes", "the tabs sit too high", "--agent", polish);
  assert.match(readFileSync(path.join(product, "POLISH.md"), "utf8"), /## Round 1[\s\S]*## Round 2/);
});

test("--from takes a product in: copied, never written to, baselined, described, and anything else put back", { skip: skipChrome }, async () => {
  const { snapshot, readTokens, diffTokens } = await import("../src/ingest.mjs");
  const source = path.join(here, "fixtures", "make", "existing-spa");
  const before = snapshot(source);
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-from-")), "run");
  const ingest = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-ingest.mjs")}"`;
  const r = tells("make", "--from", source, "--approved", "home,orders", "--out", out, "--agent", ingest);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(snapshot(source), before, "the source is never written to");

  const product = path.join(out, "product");
  const state = JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));
  assert.equal(state.stage, "done");
  assert.equal(state.brief, "Roastery Hub", "the brief comes from the entry page's title");
  assert.equal(state.layout, "spa");
  assert.deepEqual(state.manifest.map((s) => [s.id, s.built, s.inShell, s.files.join(" ")]), [
    ["home", true, true, ""],
    ["orders", true, false, "screens/orders.js"],
    ["stock", true, false, "data/stock.js screens/stock.js"],
    ["later", false, true, ""],
  ]);
  assert.deepEqual(state.leads, ["home", "orders"]);
  assert.deepEqual(state.skipped, ["notes.v2.css.bak"]);
  assert.ok(!existsSync(path.join(product, "notes.v2.css.bak")), "scratch isn't copied");

  for (const theme of ["light", "dark"]) for (const id of ["home", "orders", "stock"]) assert.ok(existsSync(path.join(product, "baseline", theme, `index.html_${id}.png`)), `${theme} ${id}`);
  assert.equal(state.baseline.tokens[':root[data-theme="light"]']["--accent"], "#17703A");
  assert.ok(state.baseline.system, "consistent's system is kept as the baseline");

  assert.deepEqual(state.ingest.reverted.map((x) => `${x.file} ${x.was}`).sort(), ["data.js deleted", "extra.js added", "styles.css changed"]);
  assert.deepEqual(diffTokens(state.baseline.tokens, readTokens(product)), [], "the agent's token change is put back");
  for (const doc of ["SYSTEM.md", "CONTRACTS.md", "APPROVED.md", "PRODUCT.md"]) assert.ok(existsSync(path.join(product, doc)), doc);
  const report = readFileSync(path.join(out, "REPORT.md"), "utf8");
  assert.match(report, /Taken in from/);
  assert.match(report, /\| later \| Later \| not built yet/);
  assert.match(report, /`styles\.css` \(changed\)/);

  // Notes on a product taken in go to its routes, keep the approved decisions, and skip the blanket fix.
  const prompt = polishPrompt(state, "the tabs sit too high");
  assert.match(prompt, /APPROVED\.md/);
  assert.match(prompt, /render index\.html#\/home index\.html#\/orders index\.html#\/stock --strict/);
  assert.match(prompt, /--lead index\.html#\/home --lead index\.html#\/orders --strict/);
  assert.doesNotMatch(prompt, /fix \./);
});

test("--from names what it couldn't find", { skip: skipChrome }, () => {
  const source = path.join(here, "fixtures", "make", "existing-spa");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-from-")), "run");
  const bad = tells("make", "--from", source, "--screens", "orders: wholesale; roasts: the drum", "--out", out, "--dry-run");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no screen called "roasts".*It has: home, orders, stock, later/);
  const unbuilt = tells("make", "--from", source, "--approved", "later", "--out", out, "--dry-run");
  assert.equal(unbuilt.status, 2);
  assert.match(unbuilt.stderr, /"later", which isn't a built screen/);
  assert.ok(!existsSync(out), "nothing is copied when the input is wrong");
});

test("tokens are read by selector block, and a diff names each change", async () => {
  const { readTokens, diffTokens } = await import("../src/ingest.mjs");
  const tokens = readTokens(path.join(here, "fixtures", "make", "existing-spa"));
  assert.deepEqual(Object.keys(tokens), [':root[data-theme="light"]', ':root[data-theme="dark"]'], "the .bak file isn't read");
  const after = structuredClone(tokens);
  after[':root[data-theme="dark"]']["--accent"] = "#FF6FB5";
  delete after[':root[data-theme="light"]']["--ink"];
  assert.deepEqual(diffTokens(tokens, after), [
    { selector: ':root[data-theme="light"]', token: "--ink", was: "#1D1B18", now: null },
    { selector: ':root[data-theme="dark"]', token: "--accent", was: "#3FBF6A", now: "#FF6FB5" },
  ]);
});

test("--revise <screen> changes one screen of a product taken in, guarded, and --undo puts it back", { skip: skipChrome }, () => {
  const source = path.join(here, "fixtures", "make", "existing-spa");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-restructure-")), "run");
  const node = (f) => `"${process.execPath}" "${path.join(here, "fixtures", "make", f)}"`;
  assert.equal(tells("make", "--from", source, "--out", out, "--agent", node("fake-ingest.mjs")).status, 0);
  const product = path.join(out, "product");
  const orders = () => readFileSync(path.join(product, "screens", "orders.js"), "utf8");
  const accent = () => /--accent: (#\w+)/.exec(readFileSync(path.join(product, "styles.css"), "utf8"))[1];
  const state = () => JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));

  assert.equal(tells("make", "--resume", out, "--revise", "nothere", "--notes", "x").status, 2, "an unknown screen is a usage error");

  // A clean round: only Orders changes, and the other screens' screenshots don't move.
  const r = tells("make", "--resume", out, "--revise", "orders", "--notes", "shorter line", "--agent", node("fake-restructure.mjs"));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(orders(), /orders wait/);
  const round = state().polishes[0];
  assert.equal(round.screen, "orders");
  assert.ok(existsSync(path.join(out, "rounds", "1", "before", "screens", "orders.js")), "a snapshot is taken before the round");
  const moved = Object.fromEntries(round.shots.map((x) => [x.id, x.changed]));
  assert.ok(moved.orders > 0, "the restructured screen changed");
  assert.equal(moved.home, 0, "home didn't move");
  assert.equal(moved.stock, 0, "stock didn't move");
  assert.match(round.after, /new since it came in/);
  assert.match(readFileSync(path.join(out, "REPORT.md"), "utf8"), /After your notes on orders, round 1/);

  // --undo puts the product back as it was before the round.
  assert.equal(tells("make", "--resume", out, "--undo").status, 0);
  assert.match(orders(), /orders are waiting to be confirmed/);
  assert.equal(state().polishes.length, 0);

  // A token changed and not listed: the agent gets a second turn, and puts it back.
  const fixed = tells("make", "--resume", out, "--revise", "orders", "--notes", "sneak", "--agent", node("fake-restructure.mjs"));
  assert.equal(fixed.status, 0, fixed.stderr + fixed.stdout);
  assert.match(fixed.stdout, /--accent/);
  assert.equal(accent(), "#17703A");
  assert.equal(state().polishes[0].run.turns, 2);
  assert.equal(tells("make", "--resume", out, "--undo").status, 0);

  // Still there after the second turn: the whole round is put back, and the run fails.
  const stuck = tells("make", "--resume", out, "--revise", "orders", "--notes", "sneak and stay", "--agent", node("fake-restructure.mjs"));
  assert.equal(stuck.status, 1);
  assert.equal(accent(), "#17703A");
  assert.match(orders(), /orders are waiting to be confirmed/, "the round's other changes go too");
  assert.match(readFileSync(path.join(out, "rounds", "1", "GUARD.md"), "utf8"), /--accent.*not listed/);
  assert.equal(state().polishes.length, 0);
});

test("the guard names tokens the round didn't list, and other screens that drifted", async () => {
  const { listedTokens, roundText, tokenViolations, traitViolations } = await import("../src/guard.mjs");
  const log = "## Round 1\n\n### Tokens changed\n\n- `--q`: 336px, for the quadrants\n\n## Round 2\n\nOrders.\n\n### Tokens changed\n\n- `--accent`, the note asked for pink\n";
  assert.deepEqual([...listedTokens(roundText(log, 2))], ["--accent"]);
  assert.deepEqual([...listedTokens(roundText(log, 1))], ["--q"]);
  const before = { ":root": { "--accent": "#17703A", "--ink": "#1D1B18" } };
  const after = { ":root": { "--accent": "#FF6FB5", "--ink": "#000000" } };
  assert.deepEqual(tokenViolations(before, after, listedTokens(roundText(log, 2))).map((v) => v.token), ["--ink"]);
  // New names are the round's own; an approved name set again somewhere new overrides it there.
  const added = { ...after, ":root": { ...before[":root"] }, ".home": { "--q": "336px", "--ink": "#FF0000" } };
  assert.deepEqual(tokenViolations(before, added, new Set()).map((v) => `${v.selector} ${v.token}`), [".home --ink"]);

  const traits = (h1, panel) => ({ families: ["apfel"], h1, h2: 20, page: [243, 242, 238], panel: { radius: 0, bg: "#f3f2ee", border: "#d2cfc6", ...panel }, marks: ["dots"], layout: "sidebar-main", accents: [4] });
  const base = [{ target: "index.html#/home", traits: traits(28) }, { target: "index.html#/money", traits: traits(28) }];
  const now = [{ target: "index.html#/home", traits: traits(40) }, { target: "index.html#/money", traits: traits(28, { radius: 12 }) }];
  assert.deepEqual(traitViolations(base, now, new Set(["index.html#/home"])).map((v) => `${v.target} ${v.rule}`), ["index.html#/money drift-panel"]);
});

test("--carry lays one screen's layout onto others; --add builds a new screen the house way", { skip: skipChrome }, () => {
  const source = path.join(here, "fixtures", "make", "existing-spa");
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tells-carry-")), "run");
  const node = (f) => `"${process.execPath}" "${path.join(here, "fixtures", "make", f)}"`;
  assert.equal(tells("make", "--from", source, "--out", out, "--agent", node("fake-ingest.mjs")).status, 0);
  const product = path.join(out, "product");
  const file = (f) => readFileSync(path.join(product, f), "utf8");
  const state = () => JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));

  assert.equal(tells("make", "--resume", out, "--carry", "nothere").status, 2);
  assert.equal(tells("make", "--resume", out, "--carry", "orders", "--to", "orders").status, 2, "a screen isn't carried onto itself");
  assert.equal(tells("make", "--resume", out, "--add", "orders: again").status, 2, "--add takes new screens");

  const c = tells("make", "--resume", out, "--carry", "orders", "--to", "stock,home", "--agent", node("fake-carry.mjs"));
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.ok(existsSync(path.join(product, "PATTERN.md")));
  assert.match(file("screens/stock.js"), /ruled/, "a screen with its own files is laid in its copy, and its files come back");
  assert.match(file("app.js"), /ruled/, "a screen the shell draws is laid in place");
  assert.match(file("styles.css"), /#17703A/, "a shared file edited in a copy doesn't come back");
  assert.equal(state().polishes[0].carry, "orders");
  assert.deepEqual(state().polishes[0].to, ["stock", "home"]);

  const a = tells("make", "--resume", out, "--add", "roasts: the week's batches", "--agent", node("fake-add.mjs"));
  assert.equal(a.status, 0, a.stderr + a.stdout);
  const roasts = state().manifest.find((x) => x.id === "roasts");
  assert.deepEqual([roasts.built, roasts.target, roasts.files.join(" "), roasts.job], [true, "index.html#/roasts", "screens/roasts.js", "the week's batches"]);
  assert.ok(state().screens.some((x) => x.id === "roasts"));
  assert.ok(JSON.parse(file("screens.json")).some((x) => x.id === "roasts"));
  assert.ok(existsSync(path.join(out, "rounds", "2", "shots", "index.html_roasts.png")));
});

const fakeClaude = [process.execPath, path.join(here, "fixtures", "make", "fake-claude.mjs")];
const runFake = async (mode) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tells-agent-"));
  process.env.FAKE_CLAUDE = mode;
  try {
    const stream = path.join(dir, "agents", "system-v1.jsonl");
    return { dir, stream, r: await runAgent({ dir, prompt: "build it", timeoutMs: 30_000, stream, command: fakeClaude }) };
  } finally {
    delete process.env.FAKE_CLAUDE;
  }
};

test("the default agent's stream is kept, stamped, and its result says what the run cost", async () => {
  const { dir, stream, r } = await runFake("");
  assert.equal(r.ok, true);
  assert.equal(r.costUsd, 0.42);
  assert.equal(r.turns, 4);
  assert.equal(r.apiMs, 1234);
  assert.deepEqual(r.tokens, { input: 10, output: 500, cacheRead: 90000, cacheWrite: 30000 });
  assert.equal(r.signInEnds, "2026-11-27T19:26:36.368Z");
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  for (const flag of ["--strict-mcp-config", "--disable-slash-commands"]) assert.ok(argv.includes(flag), `${flag}: none of the user's MCP servers or skills`);
  assert.equal(argv[argv.indexOf("--setting-sources") + 1], "project,local", "none of the user's own hooks or plugins");
  assert.ok(Date.parse(r.started) <= Date.parse(r.ended));
  const events = readFileSync(stream, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, 5, "every event, and not the stray line");
  assert.ok(events.every((e) => typeof e.at === "number"));
  const log = readFileSync(path.join(dir, "agent.log"), "utf8");
  assert.match(log, /Built index\.html\./, "the final answer reads in agent.log as before");
  assert.match(log, /a stray line/, "a line that isn't an event is kept in the log");
  const s = readStream(stream);
  assert.deepEqual(s.tools.map((t) => [t.name, t.detail]), [["Bash", "node bin/tells.mjs render index.html --strict"], ["Write", "index.html"]]);
});

test("a result line with no trailing newline is still read", async () => {
  const { r } = await runFake("unterminated");
  assert.equal(r.costUsd, 0.42);
});

test("a stream that ends with no result still resolves, with seconds and no usage", async () => {
  const { stream, r } = await runFake("no-result");
  assert.equal(r.ok, false);
  assert.equal(r.error, "exit 1");
  assert.equal(typeof r.seconds, "number");
  assert.equal(r.costUsd, undefined);
  assert.equal(readStream(stream).finished, false);
  assert.equal(readStream(stream).tools.length, 2, "the tool calls it made before stopping are kept");
});

test("cost lines add up measured runs and say when some weren't measured", () => {
  const a = { seconds: 600, costUsd: 1.5, tokens: { input: 1000, output: 20000, cacheRead: 800000, cacheWrite: 100000 } };
  const b = { seconds: 300 };
  assert.equal(costLine([a, a]), "2 agents, 20m, $3.00, 1.8M in (1.6M cached) / 40k out");
  assert.equal(costLine([a, b]), "2 agents, 15m, $1.50, 901k in (800k cached) / 20k out, 1 not measured");
  assert.equal(costLine([b]), "1 agent, 5m");
});

test("the timeline puts agents in order, counts overlaps once, and names the waits between them", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tells-timeline-"));
  const t0 = Date.parse("2026-11-25T10:00:00Z");
  const at = (min) => new Date(t0 + min * 60_000).toISOString();
  const stream = (label, start, end, cost) => {
    mkdirSync(path.join(out, "agents"), { recursive: true });
    const lines = [
      { at: t0 + start * 60_000, type: "system", subtype: "init" },
      { at: t0 + (start + 1) * 60_000, type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "SYSTEM.md" } }] } },
      { at: t0 + end * 60_000, type: "result", total_cost_usd: cost, num_turns: 3, usage: {} },
    ];
    writeFileSync(path.join(out, "agents", `${label}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  };
  stream("system-v1", 0, 16, 2);
  stream("system-v2", 0, 18, 2.5);
  stream("screen-orders", 60, 70, 1);
  writeFileSync(
    path.join(out, "product.json"),
    JSON.stringify({
      brief: "a roaster back office",
      runs: {
        v1: { ok: true, seconds: 960, started: at(0), ended: at(16) },
        v2: { ok: true, seconds: 1080, started: at(0), ended: at(18) },
        orders: { ok: true, seconds: 600, started: at(60), ended: at(70) },
        review: { ok: true, seconds: 300, started: at(71), ended: at(76) },
      },
    }),
  );
  const t = timeline(out);
  assert.deepEqual(t.agents.map((a) => a.label), ["system-v1", "system-v2", "screen-orders", "review"]);
  assert.equal(t.wallMinutes, 76);
  assert.equal(t.agentPathMinutes, 18 + 10 + 5);
  assert.equal(t.agentMinutes, 16 + 18 + 10 + 5);
  assert.equal(t.costUsd, 5.5);
  assert.deepEqual(t.waits.map((w) => [w.minutes, w.before]), [[42, "screen-orders"]], "a minute of checks between screens and review isn't a wait");
  assert.equal(t.agents.find((a) => a.label === "review").streamed, false, "a run without a stream still shows");
  assert.equal(t.agents[0].tools[0].detail, "SYSTEM.md");
});

test("--product: a variant failing its own checks gets one fix round before you see it; widths reach every agent; screen agents get only what they need", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tells-product-"));
  const fake = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-product.mjs")}"`;
  const r = tells("make", "a roaster's back office", "--product", "--screens", "today: what ships; orders: placed to paid; stock: green and roasted", "--widths", "1440,960", "--out", out, "--agent", fake, "--no-render");
  assert.equal(r.status, 0, r.stderr);
  const state = JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));
  assert.deepEqual(state.widths, [1440, 960]);
  for (const v of ["v1", "v2"]) {
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, v, ".tellsrc"), "utf8")), { shortcuts: [], widths: [1440, 960] }, `${v}: the widths are put back after the agent rewrote .tellsrc`);
  }
  // v1 was clean: no fix round. v2 had a generic CTA: one round, then clean.
  assert.deepEqual(state.fixes.map((f) => f.v), ["v2"]);
  assert.match(state.fixes[0].before, /check 2E/, "both lead screens");
  assert.match(state.fixes[0].after, /check 0E/);
  assert.equal(state.fixes[0].left, undefined);
  assert.match(readFileSync(path.join(out, "v2", "FIXES.md"), "utf8"), /generic-cta/, "the fix agent is given the errors");
  assert.doesNotMatch(readFileSync(path.join(out, "v2", "screens", "today.html"), "utf8"), /Learn more/);
  const checkpoint = readFileSync(path.join(out, "CHECKPOINT.md"), "utf8");
  assert.match(checkpoint, /## v2[\s\S]*one fix round/);
  assert.doesNotMatch(checkpoint, /Still failing/);
  assert.match(readFileSync(path.join(out, "v2", "FIX-1.md"), "utf8"), /- check: screens\/today\.html:\d+ `generic-cta`/);

  const a = tells("make", "--resume", out, "--approve", "v2", "--agent", fake);
  assert.equal(a.status, 0, a.stderr + a.stdout);
  const seen = JSON.parse(readFileSync(path.join(out, "product", "screens", "stock.needs.md"), "utf8"));
  for (const f of ["CRITIQUE.md", "STUDY.md", "FIXES.md", "shots"]) assert.ok(!seen.files.includes(f), `a screen agent isn't given ${f}`);
  for (const f of ["SYSTEM.md", "CONTRACTS.md", "NOTES.md", "system", "screens", "system-shots"]) assert.ok(seen.files.includes(f), `a screen agent is given ${f}`);
  assert.deepEqual(seen.tellsrc.widths, [1440, 960], "the screen agent's own render checks the product's widths");
  assert.match(readFileSync(path.join(out, "REPORT.md"), "utf8"), /- System: 3 agents/, "the fix round counts in the system stage");
});

test(".tellsrc widths: render uses them when --widths isn't given; a bad list is reported", { skip: skipChrome }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tells-widths-"));
  writeFileSync(path.join(dir, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stock</title></head><body><main><h1>Stock</h1><p>Twelve kilos of Huila left.</p></main></body></html>');
  writeFileSync(path.join(dir, ".tellsrc"), JSON.stringify({ widths: [1200] }));
  const own = JSON.parse(tells("render", dir, "--json").stdout);
  assert.deepEqual(own.targets.map((t) => t.widths), [[1200]]);
  const flag = JSON.parse(tells("render", dir, "--json", "--widths", "800").stdout);
  assert.deepEqual(flag.targets.map((t) => t.widths), [[800]], "the flag still wins");
  writeFileSync(path.join(dir, ".tellsrc"), JSON.stringify({ widths: [100] }));
  const bad = JSON.parse(tells("check", dir, "--json").stdout);
  assert.ok(bad.hits.some((h) => h.rule === "ok-unknown" && /widths must be/.test(h.snippet)));
});

test("--product: a variant still failing after its fix round is marked at the checkpoint, with its errors", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tells-product-"));
  const fake = `"${process.execPath}" "${path.join(here, "fixtures", "make", "fake-product.mjs")}"`;
  const r = tellsIn({ FAKE_FIX: "none" }, "make", "a roaster's back office", "--product", "--screens", "today: what ships; orders: placed to paid; stock: green and roasted", "--out", out, "--agent", fake);
  assert.equal(r.status, 0, r.stderr);
  const state = JSON.parse(readFileSync(path.join(out, "product.json"), "utf8"));
  assert.equal(state.fixes.length, 1, "one round only");
  assert.equal(state.fixes[0].left.length, 2);
  assert.match(readFileSync(path.join(out, "CHECKPOINT.md"), "utf8"), /## v2[\s\S]*Failed its own checks when built[\s\S]*\*\*Still failing:\*\*\n\n- check: screens\/(today|orders)\.html:\d+ `generic-cta`/);
  assert.match(r.stdout, /v2 .*still failing after its fix round/);
});
