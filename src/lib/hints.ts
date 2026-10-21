// Gentle hints about R habits that work today and cause trouble later.
//
// None of these is an error, so none stops a script. Each is a common
// stumble for people learning R, and each has a one line reason and,
// where the better way is clear, a fix: T and F for TRUE and FALSE, which
// anyone can overwrite; x == NA, which is always NA; 1:length(x), which
// counts backward when x is empty; setwd() in a project, which ties the
// script to one computer; and rm(list = ls()), which looks like a fresh
// start but is not one. The list is short on purpose. A hint that fires
// too often teaches people to ignore all of them.
//
// It reads code as text, with the Shiny checker's tokenizer, and depends
// on nothing else, so it can be tested alone.

import { tokenize } from "./shinyCheck";

/** One hint, at a zero based line and columns, with the text that fixes
 * it when there is one. */
export type Hint = { line: number; from: number; to: number; title: string; detail: string; fix?: string };

type Token = ReturnType<typeof tokenize>[number];

/** The hints for a script or a document's code. `inProject` says whether
 * the file belongs to a project, where setwd() is the wrong tool. */
export function findHints(code: string, inProject: boolean): Hint[] {
  const tokens = tokenize(code);
  const hints: Hint[] = [];
  const at = (token: Token, end: Token, title: string, detail: string, fix?: string) =>
    hints.push({ line: token.line, from: token.col, to: end.line === token.line ? end.end : token.end, title, detail, fix });
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  // A script that defines T or F itself is left alone.
  const ownTF = new Set(tokens.filter((token, k) => (token.text === "T" || token.text === "F") && (isOp(k + 1, "<-") || isOp(k + 1, "="))).map((token) => token.text));

  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.kind !== "ident") continue;
    const after$ = isOp(k - 1, "$") || isOp(k - 1, "@") || isOp(k - 1, "::");
    // T and F used as values.
    if ((token.text === "T" || token.text === "F") && !after$ && !ownTF.has(token.text) && !isOp(k + 1, "=") && !isOp(k + 1, "(") && !isOp(k + 1, "<-")) {
      const word = token.text === "T" ? "TRUE" : "FALSE";
      at(token, token, `Write ${word} in full`, `${token.text} is a name anyone can change, for example by making a variable called ${token.text}. ${word} always means ${word.toLowerCase()}.`, word);
      continue;
    }
    // setwd() inside a project.
    if (token.text === "setwd" && isOp(k + 1, "(") && inProject && !after$) {
      at(token, token, "setwd() ties this script to one computer", "In a project, R already works in the project folder, so paths such as data/file.csv work on any computer. A folder written here only exists on this one.");
      continue;
    }
    // rm(list = ls()).
    if (token.text === "rm" && isOp(k + 1, "(") && tokens[k + 2]?.text === "list" && isOp(k + 3, "=") && tokens[k + 4]?.text === "ls") {
      at(token, tokens[k + 6] ?? token, "This is not a fresh start", "It removes your objects, but loaded packages and changed options stay. Restart R, in the Run menu, gives a truly fresh start.");
      continue;
    }
    // 1:length(x) and 1:nrow(x), which count 1, 0 when x is empty.
    if ((token.text === "length" || token.text === "nrow") && isOp(k + 1, "(") && isOp(k - 1, ":") && tokens[k - 2]?.text === "1") {
      let depth = 0;
      let close = k + 1;
      for (; close < tokens.length; close += 1) {
        if (isOp(close, "(")) depth += 1;
        else if (isOp(close, ")")) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const start = tokens[k - 2];
      const end = tokens[close];
      if (!end || end.line !== start.line) continue;
      const inner = code.split("\n")[start.line].slice(tokens[k + 2].col, end.col);
      const fix = token.text === "length" ? `seq_along(${inner})` : `seq_len(nrow(${inner}))`;
      at(start, end, `Use ${token.text === "length" ? "seq_along()" : "seq_len()"} here`, `When there is nothing to count, 1:${token.text}() gives 1 and 0, so a loop runs twice when it should not run at all. ${fix} gives nothing.`, fix);
    }
  }

  // x == NA and x != NA, which are always NA.
  for (let k = 1; k < tokens.length; k += 1) {
    if (!(isOp(k, "==") || isOp(k, "!=")) || tokens[k + 1]?.text !== "NA") continue;
    // The left side, when it is a plain name or a column, such as x$col.
    let start = k - 1;
    while (start >= 2 && isOp(start - 1, "$") && tokens[start - 2]?.kind === "ident") start -= 2;
    if (tokens[start]?.kind !== "ident" || tokens[start].line !== tokens[k + 1].line) continue;
    const left = code.split("\n")[tokens[start].line].slice(tokens[start].col, tokens[k - 1].end);
    const fix = `${isOp(k, "!=") ? "!" : ""}is.na(${left})`;
    at(tokens[start], tokens[k + 1], "Compare with NA using is.na()", `Comparing anything with NA gives NA, never TRUE or FALSE, so this test never works. ${fix} does what was meant.`, fix);
  }
  return hints.sort((a, b) => a.line - b.line || a.from - b.from);
}
