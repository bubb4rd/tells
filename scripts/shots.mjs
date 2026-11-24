#!/usr/bin/env node
// Renders docs/shots/<name>.html to docs/assets/<name>.png in headless Chrome.
// Each page sets its size with <meta name="shot" content="WIDTHxHEIGHT[@SCALE]">.
//   node scripts/shots.mjs            all shots
//   node scripts/shots.mjs hero icon  just these
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChrome } from "../src/render.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "docs", "shots");
const out = path.join(root, "docs", "assets");
fs.mkdirSync(out, { recursive: true });

const wanted = process.argv.slice(2);
const pages = fs.readdirSync(src).filter((f) => f.endsWith(".html") && (!wanted.length || wanted.includes(f.replace(/\.html$/, ""))));
const chrome = findChrome();

for (const page of pages) {
  const html = fs.readFileSync(path.join(src, page), "utf8");
  const m = /<meta name="shot" content="(\d+)x(\d+)(?:@(\d+))?"/.exec(html);
  if (!m) throw new Error(`${page}: missing <meta name="shot" content="WxH@scale">`);
  const [, w, h, scale = "2"] = m;
  const target = path.join(out, page.replace(/\.html$/, ".png"));
  const r = spawnSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--default-background-color=00000000",
    `--window-size=${w},${h}`, `--force-device-scale-factor=${scale}`,
    "--virtual-time-budget=6000", `--screenshot=${target}`,
    pathToFileURL(path.join(src, page)).href,
  ], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(target)) throw new Error(`${page}: Chrome failed\n${r.stderr}`);
  console.log(`${path.relative(root, target)}  ${w * scale}×${h * scale}`);
}
