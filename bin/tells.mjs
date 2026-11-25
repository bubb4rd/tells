#!/usr/bin/env node
import { readFileSync } from "node:fs";

const HELP = `tells: find the marks of default, AI-generated UI

Usage
  tells check  [paths...]        Static audit of HTML, CSS, JSX, TSX and MDX source
  tells fix    [paths...]        Rewrite the hits that have one right answer, then report the rest
  tells render [files|dirs|urls] Rendered audit in headless Chrome at 1440, 960 and 390px
  tells same   [designs|urls...] Catch a design that lands on a cliché cluster, your house style or a sibling
  tells pick   <variants...>     Choose between variants with checks: errors, exceptions, sameness, warnings
  tells make   "<brief>"         Build variants in parallel with an agent, fix them, pick one, write a report
  tells rules  [check|render|same] List every rule with its severity and fix

Flags
  --json          Machine-readable output
  --strict        Fail on warnings as well as errors
  --rule <id>     Run one rule
  --dry-run       fix: show what would change, write nothing
  --radius <css>  fix: radius that replaces pills (default 6px)
  --against <p>   same, pick, make: past designs to compare with (repeatable)
  --house <p>     same, pick, make: compare with this design instead of the majority
  --rendered      same: fingerprint rendered styles, colour role and layout in headless Chrome
  --variants <n>  make: how many to build (default 4)
  --agent <cmd>   make: agent command that reads the prompt on stdin (default claude -p)
  --no-render     same, pick, make: skip the headless Chrome checks
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
} else if (cmd === "make") {
  await (await import("../src/make.mjs")).run(rest);
} else if (cmd === "pick") {
  (await import("../src/pick.mjs")).run(rest);
} else if (cmd === "same") {
  await (await import("../src/same.mjs")).run(rest).catch((err) => {
    console.error(`tells same: ${err.message}`);
    process.exit(2);
  });
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
  if (!which || which === "same") {
    if (!which) console.log("\nsame");
    (await import("../src/same.mjs")).run(["--rules"]);
  }
} else {
  console.error(`tells: unknown command "${cmd}"\n`);
  process.stderr.write(HELP);
  process.exit(2);
}
