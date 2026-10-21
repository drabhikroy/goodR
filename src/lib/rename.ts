// Renaming an object everywhere it appears in a script, and nowhere else.
//
// A plain find and replace would also change the name inside text, in
// comments, as a column after a dollar sign, as an argument name such as
// data = in a call, and inside longer names. Each of those means
// something else, so only the places where the name is the object itself
// are changed. Positions count lines and columns from zero.
//
// It depends on nothing but the tokenizer, so it can be tested alone.

import { tokenize } from "./shinyCheck";

export type Place = { line: number; from: number; to: number };

/** Whether a name can be written without backquotes. */
export function isPlainName(name: string) {
  return /^([A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]*$/.test(name) && !RESERVED.has(name);
}

const RESERVED = new Set(["if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE", "NULL", "Inf", "NaN", "NA", "in"]);

/** Every place `name` stands for the object in `code`. */
export function renamePlaces(code: string, name: string): Place[] {
  const tokens = tokenize(code);
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  const places: Place[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.kind !== "ident" || token.text !== name) continue;
    // A column, a slot, or a name from another package.
    if (isOp(k - 1, "$") || isOp(k - 1, "@") || isOp(k - 1, "::") || isOp(k - 1, ":::")) continue;
    // An argument name inside a call, as in f(data = x).
    if (isOp(k + 1, "=") && (isOp(k - 1, "(") || isOp(k - 1, ","))) continue;
    places.push({ line: token.line, from: token.col, to: token.end });
  }
  return places;
}
