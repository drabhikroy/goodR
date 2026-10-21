// Tidying one line of R as it is finished, the way the tidyverse style
// guide lays code out: a space on each side of <- and the other operators
// between two values, a space after each comma, and none just inside
// brackets or before a call's opening bracket.
//
// Only the spaces between pieces of code change. Text in strings and
// comments, names in backquotes, and the line's indentation are kept
// exactly, so the meaning never changes. A line that ends inside a string
// is left alone, since its end is not yet known.
//
// It reads one line at a time and depends on nothing, so it can be tested
// alone and is quick enough to run on every Return.

type Piece = { kind: "word" | "number" | "string" | "op" | "open" | "close" | "comma" | "comment" | "other"; text: string };

// Operators, longest first, so <<- is read before <- and <.
const OPERATORS = ["<<-", "->>", "|>", "<-", "->", "<=", ">=", "==", "!=", "&&", "||", ":::", "::", ":=", "**"];
// Operators written without spaces around them.
const TIGHT = new Set(["::", ":::", "$", "@", ":", "^", "?"]);
// Operators that can stand before a single value, as in -1 or !done.
const UNARY = new Set(["-", "+", "!", "~"]);
const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "function"]);
// Calls that are written with a space before the bracket, by convention.
const SPACED = new Set(["if", "for", "while"]);

/** Splits a line into pieces, or returns null when it ends inside a
 * string, which the next line continues. */
function pieces(line: string): Piece[] | null {
  const found: Piece[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === "#") {
      found.push({ kind: "comment", text: line.slice(i) });
      break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      if (j >= line.length) return null;
      found.push({ kind: ch === "`" ? "word" : "string", text: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Raw strings, r"(...)", are kept whole, or the line is left alone.
    if ((ch === "r" || ch === "R") && (line[i + 1] === '"' || line[i + 1] === "'")) {
      const quote = line[i + 1];
      const dashes = /^-*/.exec(line.slice(i + 2))![0];
      const open = line[i + 2 + dashes.length];
      const close = { "(": ")", "[": "]", "{": "}" }[open as "(" | "[" | "{"];
      if (close) {
        const end = line.indexOf(`${close}${dashes}${quote}`, i + 3 + dashes.length);
        if (end < 0) return null;
        const stop = end + close.length + dashes.length + 1;
        found.push({ kind: "string", text: line.slice(i, stop) });
        i = stop;
        continue;
      }
    }
    const number = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)[iL]?/.exec(line.slice(i));
    if (number && !/[A-Za-z_.]/.test(line[i - 1] ?? "")) {
      found.push({ kind: "number", text: number[0] });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z._][\w.]*/.exec(line.slice(i));
    if (word) {
      found.push({ kind: "word", text: word[0] });
      i += word[0].length;
      continue;
    }
    if (ch === "%") {
      const end = line.indexOf("%", i + 1);
      if (end > i) {
        found.push({ kind: "op", text: line.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    const op = OPERATORS.find((candidate) => line.startsWith(candidate, i));
    if (op) {
      found.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    if ("([{".includes(ch)) found.push({ kind: "open", text: ch });
    else if (")]}".includes(ch)) found.push({ kind: "close", text: ch });
    else if (ch === ",") found.push({ kind: "comma", text: ch });
    else if ("+-*/^<>=!&|~:$@?\\;".includes(ch)) found.push({ kind: "op", text: ch });
    else found.push({ kind: "other", text: ch });
    i += 1;
  }
  return found;
}

/** Whether an operator at `k` stands before a single value, as in -1 or
 * !x, rather than between two. */
function isUnary(list: Piece[], k: number) {
  if (!UNARY.has(list[k].text)) return false;
  const before = list[k - 1];
  return !before || before.kind === "op" || before.kind === "open" || before.kind === "comma" || (before.kind === "word" && KEYWORDS.has(before.text));
}

/** The space wanted between two neighboring pieces. */
function gap(list: Piece[], k: number): string {
  const left = list[k - 1];
  const right = list[k];
  if (right.kind === "comment") return "  ";
  if (right.kind === "comma") return "";
  if (left.kind === "comma") return " ";
  if (left.text === "\\") return "";
  if (right.text === "{") return " ";
  if (left.kind === "open") return left.text === "{" ? " " : "";
  if (right.kind === "close") return right.text === "}" ? " " : "";
  if (right.kind === "open" && right.text !== "{") {
    if (left.kind === "word" && SPACED.has(left.text)) return " ";
    if (left.kind === "word" || left.kind === "close" || left.kind === "string") return "";
  }
  if (left.kind === "op" && isUnary(list, k - 1)) return "";
  if (right.kind === "op" && TIGHT.has(right.text)) return "";
  if (left.kind === "op" && TIGHT.has(left.text)) return "";
  if (right.kind === "op" || left.kind === "op") return right.text === ";" ? "" : " ";
  return " ";
}

/** The line tidied, or the line as it was when it cannot be read safely.
 * Indentation is kept as typed. */
export function formatLine(line: string): string {
  const indent = /^\s*/.exec(line)![0];
  const body = line.slice(indent.length);
  if (!body.trim() || body.startsWith("#")) return line;
  const list = pieces(body);
  if (!list || list.some((piece) => piece.kind === "other")) return line;
  let out = list[0].text;
  for (let k = 1; k < list.length; k += 1) out += gap(list, k) + list[k].text;
  // A comment after code keeps the space it was typed with, at least one.
  const comment = list[list.length - 1];
  if (comment.kind === "comment" && list.length > 1) {
    const typed = /\s*$/.exec(body.slice(0, body.length - comment.text.length))![0];
    out = out.slice(0, out.length - comment.text.length).trimEnd() + (typed || " ") + comment.text;
  }
  return indent + out;
}
