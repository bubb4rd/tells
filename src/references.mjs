/**
 * tells refs: your library of reference screens, the screens whose finish you want `make` to reach.
 *
 * Usage:
 *   tells refs                                   List the library
 *   tells refs add <url|file> --kind <kind> --why "<reason>" [--name <name>] [--full]
 *   tells refs remove <name>
 *
 * A reference is a screenshot (1440×900) of a shipped screen, its URL, a kind (dashboard, list, quote, forecast…)
 * and one line on why it's good. The library lives in ~/.tells/references (or $TELLS_REFERENCES), outside any
 * repo, because the screenshots are other people's work. `tells make --reference <name|url|file>` and
 * `tells make --kind <kind>` read it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measurePages } from "./measure.mjs";

const IMAGE = /\.(png|jpe?g|webp)$/i;
const isUrl = (s) => /^https?:\/\//i.test(s);

export const libDir = () => path.resolve(process.env.TELLS_REFERENCES || path.join(os.homedir(), ".tells", "references"));
const indexFile = () => path.join(libDir(), "index.json");

export function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8"));
  } catch {
    return [];
  }
}

function saveLibrary(entries) {
  fs.mkdirSync(libDir(), { recursive: true });
  fs.writeFileSync(indexFile(), JSON.stringify(entries, null, 2) + "\n");
}

export const nameFor = (source) =>
  (isUrl(source) ? source.replace(/^https?:\/\/(www\.)?/i, "") : path.basename(source).replace(/\.[^.]+$/, ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "reference";

/** A 1440×900 screenshot of a URL or HTML file, written to `file`. */
async function screenshot(source, file, { fullPage = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tells-ref-"));
  try {
    const [m] = await measurePages([source], { shots: tmp, fullPage });
    if (!m || m.error || !m.shot) throw new Error(`couldn't capture ${source}${m?.error ? `: ${m.error}` : ""}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(m.shot, file);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function addReference({ source, name, kind, why, fullPage = false }) {
  if (!kind || !why) throw new Error("a reference needs --kind and --why: say what kind of screen it is and why it's good");
  name = name || nameFor(source);
  const shot = path.join(libDir(), `${name}.png`);
  if (IMAGE.test(source)) {
    fs.mkdirSync(libDir(), { recursive: true });
    fs.copyFileSync(path.resolve(source), shot);
  } else await screenshot(isUrl(source) ? source : path.resolve(source), shot, { fullPage });
  const entry = { name, kind, why, url: isUrl(source) ? source : null, shot: path.basename(shot), added: new Date().toISOString().slice(0, 10) };
  saveLibrary([...loadLibrary().filter((e) => e.name !== name), entry]);
  return entry;
}

export function removeReference(name) {
  const entries = loadLibrary();
  const hit = entries.find((e) => e.name === name);
  if (!hit) return false;
  saveLibrary(entries.filter((e) => e !== hit));
  fs.rmSync(path.join(libDir(), hit.shot), { force: true });
  return true;
}

/**
 * Turn --reference and --kind values into screenshots on disk.
 * A value is a library name, a URL, an HTML file, or an image file. URLs and HTML files are captured into `dir`.
 */
export async function resolveReferences({ specs = [], kinds = [], dir, fullPage = false }) {
  const lib = loadLibrary();
  const out = [];
  const seen = new Set();
  const push = (r) => {
    if (!seen.has(r.png)) {
      seen.add(r.png);
      out.push(r);
    }
  };
  for (const kind of kinds) {
    const hits = lib.filter((e) => e.kind === kind);
    if (!hits.length) throw new Error(`no references of kind "${kind}" in ${libDir()}. Add one with: tells refs add <url> --kind ${kind} --why "<reason>"`);
    for (const e of hits) push({ name: e.name, url: e.url, why: e.why, png: path.join(libDir(), e.shot) });
  }
  for (const spec of specs) {
    const e = lib.find((x) => x.name === spec);
    if (e) push({ name: e.name, url: e.url, why: e.why, png: path.join(libDir(), e.shot) });
    else if (IMAGE.test(spec)) {
      if (!fs.existsSync(spec)) throw new Error(`reference not found: ${spec}`);
      push({ name: nameFor(spec), url: null, why: null, png: path.resolve(spec) });
    } else if (isUrl(spec) || /\.html?$/i.test(spec)) {
      const png = path.join(dir, `${nameFor(spec)}.png`);
      await screenshot(isUrl(spec) ? spec : path.resolve(spec), png, { fullPage });
      push({ name: nameFor(spec), url: isUrl(spec) ? spec : null, why: null, png });
    } else throw new Error(`"${spec}" isn't in your reference library (${libDir()}), a URL, an HTML file or an image`);
  }
  return out;
}

export async function run(argv = process.argv.slice(2)) {
  const [sub, ...rest] = argv;
  const flag = (k) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : null;
  };
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")));
  if (!sub || sub === "list") {
    const lib = loadLibrary();
    if (!lib.length) {
      console.log(`No references yet in ${libDir()}.\nAdd one: tells refs add <url> --kind <kind> --why "<what makes it good>"`);
      return;
    }
    for (const e of [...lib].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))) {
      console.log(`${e.kind.padEnd(12)} ${e.name.padEnd(32)} ${e.why}${e.url ? `\n${" ".repeat(46)}${e.url}` : ""}`);
    }
    return;
  }
  if (sub === "add") {
    if (!positional[0]) throw new Error('usage: tells refs add <url|file> --kind <kind> --why "<reason>" [--name <name>] [--full]');
    const e = await addReference({ source: positional[0], name: flag("name"), kind: flag("kind"), why: flag("why"), fullPage: rest.includes("--full") });
    console.log(`Added ${e.name} (${e.kind}) to ${libDir()}`);
    return;
  }
  if (sub === "remove") {
    if (!removeReference(positional[0])) throw new Error(`no reference named "${positional[0]}"`);
    console.log(`Removed ${positional[0]}`);
    return;
  }
  throw new Error(`unknown subcommand "${sub}". Use list, add or remove.`);
}
