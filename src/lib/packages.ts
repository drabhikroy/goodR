// Finds the packages a file uses, so the app can offer to install the ones
// that are missing before someone runs into the error.

export type PackageReference = { name: string; line: number };

// Packages that ship with R itself. They are always present, so checking
// them would only cost time.
const BASE = new Set([
  "base", "compiler", "datasets", "graphics", "grDevices", "grid", "methods", "parallel",
  "splines", "stats", "stats4", "tcltk", "tools", "utils",
]);

const VALID_NAME = /^[A-Za-z][A-Za-z0-9.]*[A-Za-z0-9]$|^[A-Za-z]$/;

/** Removes comments and string contents while keeping line positions, so
 * a commented out library() call or a "::" inside text is not mistaken for
 * a real use. Strings keep their quotes and the text of simple names, which
 * library("gt") style calls need. */
function codeOnly(text: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        out += "  ";
        i += 1;
        continue;
      }
      if (ch === quote) {
        // The closing quote is kept so library("gt") still reads as a call.
        quote = "";
        out += ch;
        continue;
      }
      out += ch === "\n" || /[A-Za-z0-9.]/.test(ch) ? ch : " ";
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    // A backtick name, such as `my data`, can hold a # that is not a comment.
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

export function referencedPackages(text: string): PackageReference[] {
  const code = codeOnly(text);
  const found = new Map<string, number>();
  const note = (name: string, index: number) => {
    if (!VALID_NAME.test(name) || BASE.has(name) || found.has(name)) return;
    found.set(name, code.slice(0, index).split("\n").length);
  };

  // library(gt), require("dplyr"), requireNamespace('x'), loadNamespace(x).
  // A call with character.only = TRUE names its package in a variable, so it
  // cannot be read here and is skipped.
  const loader = /\b(?:library|require|requireNamespace|loadNamespace)\s*\(\s*(["']?)([A-Za-z][A-Za-z0-9.]*)\1([^)]*)\)/g;
  for (const match of code.matchAll(loader)) {
    if (/character\.only\s*=\s*(?:TRUE|T)\b/.test(match[3])) continue;
    note(match[2], match.index ?? 0);
  }
  // pkg::fn and pkg:::fn.
  for (const match of code.matchAll(/(?<![A-Za-z0-9._$@])([A-Za-z][A-Za-z0-9.]*):::?(?=[A-Za-z.`])/g)) {
    note(match[1], match.index ?? 0);
  }
  return [...found].map(([name, line]) => ({ name, line })).sort((a, b) => a.line - b.line);
}

/** Where an install or update stands, read from what R prints: which
 * packages it is fetching, which are in place, and which failed. */
export type PackageProgress = { names: string[]; done: string[]; failed: string[]; current: string | null; upToDate: boolean };

// The quotes R puts around package names, straight or curly.
const Q = "['‘’]";

/** Reads install.packages() and update.packages() output as it arrives.
 * Each package shows up when its download starts, and counts as done once
 * it is unpacked or built, or failed once R says its install failed. */
export function packageProgress(output: string): PackageProgress {
  const names: string[] = [];
  const done: string[] = [];
  const failed: string[] = [];
  const add = (list: string[], name: string) => list.includes(name) || list.push(name);
  let current: string | null = null;
  for (const line of output.split("\n")) {
    const fetching = /trying URL '[^']*\/([A-Za-z][A-Za-z0-9.]*)_[^/']*'/.exec(line);
    if (fetching) {
      add(names, fetching[1]);
      current = fetching[1];
      continue;
    }
    const finished = new RegExp(`package ${Q}([A-Za-z][A-Za-z0-9.]*)${Q} successfully unpacked`).exec(line) ?? /^\* DONE \(([A-Za-z][A-Za-z0-9.]*)\)/.exec(line);
    if (finished) {
      add(names, finished[1]);
      add(done, finished[1]);
      continue;
    }
    const building = new RegExp(`^\\* installing \\*\\w+\\* package ${Q}([A-Za-z][A-Za-z0-9.]*)${Q}`).exec(line);
    if (building) {
      add(names, building[1]);
      current = building[1];
      continue;
    }
    const broken = new RegExp(`installation of package ${Q}([A-Za-z][A-Za-z0-9.]*)${Q} had non-zero exit status`).exec(line);
    if (broken) {
      add(names, broken[1]);
      add(failed, broken[1]);
    }
  }
  const settled = (name: string) => done.includes(name) || failed.includes(name);
  if (current && settled(current)) current = names.find((name) => !settled(name)) ?? null;
  return { names, done, failed, current, upToDate: names.length === 0 && /up to date|no packages/i.test(output) };
}
