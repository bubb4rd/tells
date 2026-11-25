#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { COMMANDS, UsageError, checkInputs, commandHelp, help, parseCommandLine, suggestCommand } from "../src/cli.mjs";

const MODULES = { refs: "references" };
const RULE_SETS = ["check", "render", "same", "consistent", "click"];

const [cmd, ...rest] = process.argv.slice(2);

// Every failure to run (a usage mistake, a missing path, a page that won't load, Chrome not found) exits 2,
// as `tells <command>: <what went wrong>`. TELLS_DEBUG=1 adds the stack for anything unexpected.
function fail(where, err) {
  process.stderr.write(`${where}: ${err.message}\n`);
  if (process.env.TELLS_DEBUG && !(err instanceof UsageError)) process.stderr.write(`${err.stack}\n`);
  process.exit(2);
}

async function rules(which) {
  if (which && !RULE_SETS.includes(which)) throw new UsageError(`no rule set "${which}". Choose ${RULE_SETS.join(", ")}.`);
  for (const set of RULE_SETS) {
    if (which && which !== set) continue;
    if (!which) console.log(set === RULE_SETS[0] ? set : `\n${set}`);
    await (await import(`../src/${set}.mjs`)).run(["--rules"]);
  }
}

if (!cmd || cmd === "-h" || cmd === "--help") {
  process.stdout.write(help());
} else if (cmd === "-v" || cmd === "--version") {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
} else if (cmd === "help") {
  if (!rest[0]) process.stdout.write(help());
  else if (COMMANDS[rest[0]]) process.stdout.write(commandHelp(rest[0]));
  else fail("tells help", new UsageError(`no command "${rest[0]}". Run tells --help for the list.`));
} else if (!COMMANDS[cmd]) {
  const near = suggestCommand(cmd);
  fail("tells", new UsageError(`unknown command "${cmd}".${near ? ` Did you mean tells ${near}?` : ""} Run tells --help for the list.`));
} else if (rest.includes("--help") || rest.includes("-h")) {
  process.stdout.write(commandHelp(cmd));
} else {
  try {
    const { positional, values } = parseCommandLine(cmd, rest);
    checkInputs(cmd, positional, values);
    if (cmd === "fix" && !positional.length) {
      throw new UsageError("name what to rewrite: tells fix ./src, or tells fix . for this whole folder. Add --dry-run to see the changes first.");
    }
    if (cmd === "rules") await rules(positional[0]);
    else await (await import(`../src/${MODULES[cmd] ?? cmd}.mjs`)).run(rest);
  } catch (err) {
    fail(`tells ${cmd}`, err);
  }
}
