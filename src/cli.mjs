/**
 * The command line's contract: each command, what it reads, and the flags it takes.
 *
 * bin/tells.mjs checks every call against this table before a command runs, so a typo or a wrong input
 * stops the run (exit 2) instead of quietly changing what gets checked, and it builds `tells --help` and
 * `tells <command> --help` from it, so the help can't drift from what the commands accept.
 */
import fs from "node:fs";

export const COMMANDS = {
  check: {
    usage: "[paths...]",
    summary: "Static audit of HTML, CSS, JSX, TSX, MDX and UI scripts",
    reads: "Source files and folders: .html, .css, .jsx, .tsx, .mdx, and .js, .mjs or .ts files that build HTML. Default: this folder.",
    example: "tells check ./src --strict",
    inputs: "files",
  },
  fix: {
    usage: "<paths...>",
    summary: "Rewrite the hits that have one right answer, then report the rest",
    reads: "The same files as check, and rewrites them in place. Name the paths; `tells fix .` for this whole folder.",
    example: "tells fix ./src --dry-run",
    inputs: "files",
  },
  render: {
    usage: "[files|dirs|urls]",
    summary: "Rendered audit in headless Chrome at 1440, 960 and 390px",
    reads: "HTML files, folders of them, and http(s) URLs such as a dev server. Needs Chrome, Chromium or Edge.",
    example: "tells render http://localhost:3000 ./dist/index.html",
    inputs: "pages",
  },
  same: {
    usage: "[designs|urls...]",
    summary: "Catch a design that lands on a cliché cluster, your house style or a sibling",
    reads: "Design folders (tokens.css, DESIGN.md, an HTML page), a folder of them, or URLs.",
    example: "tells same design-systems/ --against ../past-designs",
    inputs: "pages",
  },
  pick: {
    usage: "<variants...>",
    summary: "Choose between variants with checks: errors, exceptions, sameness, warnings",
    reads: "Two or more variants: folders with an index.html, or HTML files.",
    example: "tells pick tells-make/<run>/v1 tells-make/<run>/v2",
    inputs: "files",
  },
  make: {
    usage: '"<brief>"',
    summary: "Build variants in parallel with an agent, fix them, pick one, write a report",
    reads: "A brief in quotes. Screenshots, URLs and HTML go in with --reference or --current.",
    example: 'tells make "a shift handover screen for night nurses" --kind list',
  },
  measure: {
    usage: "[files|urls...]",
    summary: "Profile a rendered screen: lead, density, type steps, alignment",
    reads: "HTML files, folders of them, and http(s) URLs. Reports numbers; it never fails a screen.",
    example: "tells measure ./dist/index.html https://plausible.io/plausible.io --shots shots/",
    inputs: "pages",
  },
  consistent: {
    usage: "[screens...]",
    summary: "Check that a product's screens read as one system",
    reads: "Two or more screens of one product: HTML files, a folder of them, URLs, or routes like index.html#/inbox.",
    example: "tells consistent screens/ --lead screens/today.html --lead screens/orders.html",
    inputs: "pages",
  },
  click: {
    usage: "[files|dirs...]",
    summary: "Press every control from a fresh start: errors, dead controls, broken links",
    reads: "HTML files and folders of them. Each page loads with its storage cleared, once per control. Needs Chrome, Chromium or Edge.",
    example: "tells click screens/ --strict",
    inputs: "files",
  },
  refs: {
    usage: "[list|add|remove]",
    summary: "Your library of reference screens for make --reference",
    reads: "add takes a URL, an HTML file or a screenshot; remove takes a name.",
    example: 'tells refs add https://plausible.io/plausible.io --kind dashboard --why "six numbers, one chart"',
  },
  rules: {
    usage: "[set]",
    summary: "List every rule with its fix; sets: check, render, same, consistent, click",
    example: "tells rules render",
  },
};

// `scope` is how the flag is labelled in `tells --help`; per-command help leaves it out.
export const FLAGS = [
  { name: "json", text: "machine-readable output", cmds: ["check", "fix", "render", "same", "pick", "measure", "consistent", "click"] },
  { name: "strict", text: "fail on warnings as well as errors", cmds: ["check", "fix", "render", "consistent", "click"] },
  { name: "rule", arg: "<id>", text: "run one rule", cmds: ["check", "fix", "render"] },
  { name: "dry-run", text: "show what would change, write nothing", cmds: ["fix"] },
  { name: "radius", arg: "<css>", text: "radius that replaces pills (default 6px)", cmds: ["fix"] },
  { name: "house", arg: "<p>", text: "compare with this design instead of the majority", cmds: ["same", "pick", "make"] },
  { name: "against", arg: "<p>", text: "past designs to compare with (repeatable)", cmds: ["same", "pick", "make"] },
  { name: "rendered", text: "fingerprint rendered styles, colour role and layout in headless Chrome", cmds: ["same"] },
  { name: "reference", arg: "<r>", text: "study this screen (library name, URL, HTML or image; repeatable)", cmds: ["make"] },
  { name: "kind", arg: "<k>", text: "study every library reference of this kind", cmds: ["make"] },
  { name: "page", arg: "<p>", text: "landing or product (default: guessed from the brief)", cmds: ["make"] },
  { name: "assets", arg: "<dir>", text: "real logos, photos and art for the agents to use", cmds: ["make"] },
  { name: "current", arg: "<png>", text: "a screenshot of the page being redesigned", cmds: ["make"] },
  { name: "style", text: "take the look from the reference too, not only its finish", cmds: ["make"] },
  { name: "variants", arg: "<n>", text: "how many to build (default 4, or 2 with --product)", cmds: ["make"] },
  { name: "out", arg: "<dir>", text: "where the run goes (default tells-make/<brief>-<time>)", cmds: ["make"] },
  { name: "dry-run", text: "write the prompts, build nothing", cmds: ["make"], scope: "make", global: false },
  { name: "product", text: "several screens on one system; stops for you to approve the system (with --screens)", cmds: ["make"] },
  { name: "from", arg: "<dir>", text: "take in a product that already exists, as approved, instead of building one", cmds: ["make"], scope: "make --product" },
  { name: "approved", arg: "<s>", text: "with --from: the screens whose look was signed off, a,b,c (default: all)", cmds: ["make"], scope: "make --product" },
  { name: "screens", arg: "<s>", text: '"<id>: <job>; <id>: <job>; …", the first two are the lead screens', cmds: ["make"], scope: "make --product" },
  { name: "resume", arg: "<out>", text: "continue a --product run; --approve <v> picks its system", cmds: ["make"] },
  { name: "approve", arg: "<v>", text: "the system variant to build the screens on", cmds: ["make"], scope: "make --resume" },
  { name: "revise", arg: "<v>", text: "send a system variant back with --notes before approving; once built, `product` or (with --from) one screen", cmds: ["make"], scope: "make --resume" },
  { name: "carry", arg: "<id>", text: "with --from: lay this screen's layout onto the others (or --to a,b)", cmds: ["make"], scope: "make --resume" },
  { name: "to", arg: "<s>", text: "the screens --carry lays the layout onto, a,b,c (default: all)", cmds: ["make"], scope: "make --resume", global: false },
  { name: "add", arg: "<s>", text: 'with --from: new screens on the system, "<id>: <job>; …"', cmds: ["make"], scope: "make --resume" },
  { name: "undo", text: "put back the last round of notes on a product taken in with --from", cmds: ["make"], scope: "make --resume" },
  { name: "notes", arg: "<text>", text: "what to change in the variant named by --revise", cmds: ["make"], scope: "make --resume", global: false },
  { name: "concurrency", arg: "n", text: "screen agents at a time, default 3", cmds: ["make"], scope: "make --product" },
  { name: "agent", arg: "<cmd>", text: "agent command that reads the prompt on stdin (default claude -p)", cmds: ["make"] },
  { name: "model", arg: "<m>", text: "model for the default agent", cmds: ["make"] },
  { name: "timeout", arg: "<min>", text: "minutes each agent gets (default 20, 40 with references)", cmds: ["make"] },
  { name: "shots", arg: "<dir>", text: "save a 1440×900 screenshot of each page", cmds: ["measure"] },
  { name: "width", arg: "<px>", text: "viewport width (default 1440)", cmds: ["measure"] },
  { name: "full", text: "screenshot the whole page, up to 4,000px", cmds: ["measure", "refs"], scope: "measure, refs add" },
  { name: "kind", arg: "<k>", text: "what kind of screen it is: dashboard, list, quote…", cmds: ["refs"], global: false },
  { name: "why", arg: "<text>", text: "one line on why it's good", cmds: ["refs"], global: false },
  { name: "name", arg: "<n>", text: "name it in the library (default: from the URL or file)", cmds: ["refs"], global: false },
  { name: "no-render", text: "skip the headless Chrome checks", cmds: ["same", "pick", "make"] },
  { name: "lead", arg: "<file>", text: "the approved screens that define the system (repeatable)", cmds: ["consistent"] },
  { name: "theme", arg: "<t>", text: "light (default) or dark, whatever the machine is set to", cmds: ["render", "same", "measure", "consistent", "click"] },
  { name: "widths", arg: "a,b,c", text: "viewport widths in px (default: .tellsrc widths, else 1440,960,390)", cmds: ["render", "make"] },
  // Used between commands (`tells rules`, `tells pick`), not documented.
  { name: "rules", cmds: ["check", "render", "same", "consistent", "click"], hidden: true },
  { name: "fingerprint", arg: "<json>", cmds: ["same"], hidden: true },
  { name: "no-siblings", cmds: ["same"], hidden: true },
];

const IMAGE = /\.(png|jpe?g|webp|gif|avif|heic|bmp|tiff?)$/i;
const isUrl = (s) => /^https?:\/\//i.test(s);

export class UsageError extends Error {}
const usage = (msg) => new UsageError(msg);

const flagsFor = (cmd) => FLAGS.filter((f) => f.cmds.includes(cmd));

function nearest(word, options) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const best = options.map((o) => [o, dist(word, o)]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : null;
}

export const suggestCommand = (word) => nearest(word, Object.keys(COMMANDS));

/**
 * Check a command's arguments against its flags. Returns the positional arguments (flag values removed)
 * and each flag value. Throws a UsageError for an unknown flag or a flag that needs a value and has none.
 */
export function parseCommandLine(cmd, argv) {
  const flags = flagsFor(cmd);
  const positional = [];
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") || a === "--") {
      positional.push(a);
      continue;
    }
    const [name, ...value] = a.slice(2).split("=");
    const f = flags.find((x) => x.name === name);
    if (!f) {
      const near = nearest(name, [...new Set(flags.filter((x) => !x.hidden).map((x) => x.name))]);
      throw usage(`unknown flag --${name}.${near ? ` Did you mean --${near}?` : ""} See tells ${cmd} --help.`);
    }
    if (f.arg && !value.length) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw usage(`--${name} needs a value: --${name} ${f.arg}`);
      values.push({ name, value: argv[++i] });
    } else if (value.length) values.push({ name, value: value.join("=") });
  }
  return { positional, values };
}

// Flags whose value is a design or screen the command reads, so it's checked like a positional input.
const INPUT_FLAGS = new Set(["lead", "against", "house"]);

/** Every path a command will read must exist, and screenshots go to make, not to the linters. */
export function checkInputs(cmd, positional, values = []) {
  const kind = COMMANDS[cmd]?.inputs;
  if (!kind) return;
  const inputs = [...positional.map((p) => [p, false]), ...values.filter((v) => INPUT_FLAGS.has(v.name)).map((v) => [v.value, true])];
  for (const [inp, fromFlag] of inputs) {
    if (isUrl(inp)) {
      // A design to compare with (--against, --house) can be a live page for any command.
      if (kind !== "pages" && !fromFlag) throw usage(`${inp} is a URL, and tells ${cmd} reads source files. For a live page: tells render ${inp}`);
      continue;
    }
    // A route of a single-page app (index.html#/inbox) is its file, for every command that loads pages.
    const file = (kind === "pages" || cmd === "click") && inp.includes("#") ? inp.slice(0, inp.indexOf("#")) : inp;
    if (IMAGE.test(file)) {
      throw usage(
        `${inp} is an image. tells checks code and rendered pages, not screenshots: point it at the HTML or the URL the screenshot shows.\n` +
          `To build from a screenshot, give it to make: tells make "<brief>" --reference ${inp} (or --current ${inp} when redesigning that page).`
      );
    }
    if (!fs.existsSync(file)) throw usage(`${inp} doesn't exist.`);
  }
}

/** A whole-number flag value in range, or `fallback` when the flag isn't given. */
export function intFlag(name, raw, { min, max, fallback }) {
  if (raw === null || raw === undefined || raw === true) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw usage(`--${name} takes a whole number from ${min} to ${max}, not "${raw}".`);
  return n;
}

const capital = (s) => s[0].toUpperCase() + s.slice(1);
const flagLine = (f, text) => `  ${`--${f.name}${f.arg ? ` ${f.arg}` : ""}`.padEnd(16)}${text}`;
const commandLine = (name) => `  ${`tells ${name.padEnd(10)} ${COMMANDS[name].usage}`.padEnd(35)} ${COMMANDS[name].summary}`;

export function help() {
  const flags = FLAGS.filter((f) => !f.hidden && f.global !== false);
  const common = (f) => f.cmds.length >= 6;
  return [
    "tells: find the marks of default, AI-generated UI",
    "",
    "Usage",
    ...Object.keys(COMMANDS).map(commandLine),
    "",
    "Flags",
    ...flags.map((f) => {
      const scope = f.scope ?? (common(f) ? "" : f.cmds.join(", "));
      return flagLine(f, scope ? `${scope}: ${f.text}` : capital(f.text));
    }),
    "",
    "Run tells <command> --help for what a command reads and an example.",
    "check, fix, render, same, pick, consistent and click exit 1 when errors are found (or warnings, with --strict).",
    "Every command exits 2 when it can't run: an unknown flag, a missing path, a page that won't load.",
    "Allow one hit with a written reason:  <!-- tells-ok: <rule-id> <reason> -->",
    "Project facts (real shortcuts, project-wide exceptions) go in .tellsrc; see the README.",
    "",
  ].join("\n");
}

export function commandHelp(cmd) {
  const c = COMMANDS[cmd];
  const flags = flagsFor(cmd).filter((f) => !f.hidden);
  return [
    `tells ${cmd} ${c.usage}`,
    "",
    c.summary + ".",
    ...(c.reads ? [c.reads] : []),
    ...(flags.length
      ? ["", "Flags", ...flags.map((f) => flagLine(f, capital(f.text) + (f.scope?.startsWith(`${cmd} `) ? ` (with ${f.scope.slice(cmd.length + 1)})` : "")))]
      : []),
    "",
    "Example",
    `  ${c.example}`,
    "",
  ].join("\n");
}
