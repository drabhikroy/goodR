// Reading a model's answer: its code blocks, how closely a suggestion
// matches the code it was asked about, and whether it is a one off setup
// step. Kept apart from the controller so it can be tested on its own.

import { maskText } from "./errors";

/** The R code blocks in an answer, in order. */
export function codeBlocks(text: string): string[] {
  return [...text.matchAll(/```(?:r|R)?[^\n]*\n([\s\S]*?)(?:```|$)/g)].map((match) => match[1].replace(/\s+$/, ""));
}

/**
 * How much a suggestion looks like the code it was asked about: the share
 * of names the two have in common, comments aside. A suggestion that is a
 * corrected version of the code shares most of its names. One that is a
 * different step, such as install.packages() for a missing package,
 * shares few, and offering to put it in place of the original would
 * delete the user's code.
 */
export function likeness(original: string, suggestion: string): number {
  const names = (code: string) => new Set(maskNames(code));
  const a = names(original);
  const b = names(suggestion);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const name of a) if (b.has(name)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// The names in some code, without comments or the insides of strings.
function maskNames(code: string): string[] {
  return maskText(code).match(/[A-Za-z.][\w.]*/g) ?? [];
}

/**
 * Whether a suggestion only installs packages. Installing is done once, so
 * it belongs in the console rather than in the script, where it would run
 * again every time. Loading a package with library() does belong in the
 * script, so it does not count.
 */
export function isOneOffStep(code: string): boolean {
  const step = /^(?:(?:utils::)?install\.packages|remotes::install_\w+|pak::pkg_install)\(/;
  const lines = code.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  return lines.length > 0 && lines.every((line) => step.test(line));
}
