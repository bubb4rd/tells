#!/usr/bin/env node
import { readFileSync } from "node:fs";

const HELP = `tells: find the marks of default, AI-generated UI

Usage
  tells check  [paths...]        Static audit of HTML, CSS, JSX, TSX and MDX source
  tells fix    [paths...]        Rewrite the hits that have one right answer, then report the rest
  tells render [files|dirs|urls] Rendered audit in headless Chrome at 1440, 960 and 390px
  tells rules  [check|render]    List every rule with its severity and fix

Flags
  --json          Machine-readable output
  --strict        Fail on warnings as well as errors
  --rule <id>     Run one rule
  --dry-run       fix: show what would change, write nothing
  --radius <css>  fix: radius that replaces pills (default 6px)
  --widths a,b,c  Viewport widths for render

Exit code is 1 when errors are found (or warnings, with --strict).
Allow one hit with a written reason:  <!-- tells-ok: <rule-id> <reason> -->
`;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  process.stdout.write(HELP);
} else if (cmd === "-v" || cmd === "--version") {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
} else if (cmd === "check") {
  (await import("../src/check.mjs")).run(rest);
} else if (cmd === "fix") {
  (await import("../src/fix.mjs")).run(rest);
} else if (cmd === "render") {
  await (await import("../src/render.mjs")).run(rest).catch((err) => {
    console.error(`tells render: ${err.message}`);
    process.exit(2);
  });
} else if (cmd === "rules") {
  const which = rest[0];
  if (!which || which === "check") {
    if (!which) console.log("check");
    (await import("../src/check.mjs")).run(["--rules"]);
  }
  if (!which || which === "render") {
    if (!which) console.log("\nrender");
    await (await import("../src/render.mjs")).run(["--rules"]);
  }
} else {
  console.error(`tells: unknown command "${cmd}"\n`);
  process.stderr.write(HELP);
  process.exit(2);
}
