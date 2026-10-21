// Finds where each top level R statement starts and ends, so Run Line can
// send the whole statement under the cursor, the way RStudio does.
//
// This runs in the interface rather than asking R, because Run Line must
// respond instantly even while R is busy with something else. It follows R's
// own continuation rules: a statement continues onto the next line while a
// bracket is open, while the line ends in an operator that needs a right
// hand side, or while a control keyword such as if or function is still
// waiting for its body.

export type LineRange = { from: number; to: number };

// `line` is where a token starts and `end` where it finishes. They differ
// only for strings that span lines.
type Token = { kind: "open" | "close" | "word" | "op" | "value"; text: string; line: number; end: number };

// Infix operators that leave a statement unfinished when they end a line.
const CONTINUES = new Set([
  "+", "-", "*", "/", "^", "&", "&&", "|", "||", "=", "==", "!=", "<", ">", "<=", ">=",
  "<-", "<<-", "->", "->>", "~", "?", ":", "::", ":::", "$", "@", ",", "|>", "!", "\\",
]);

// Keywords whose parenthesized header is followed by a body. A newline right
// after the header, as in `if (x)` then a brace on the next line, continues.
const HEADERS = new Set(["if", "for", "while", "function"]);
// Keywords that need an expression after them on any line.
const NEEDS_BODY = new Set(["if", "for", "while", "function", "repeat", "else"]);

const OPERATORS = ["<<-", "->>", ":::", "|>", "<-", "->", "<=", ">=", "==", "!=", "&&", "||", "::"];

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === ";") {
      i += 1;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    // Raw strings, r"(...)", may contain quotes and newlines.
    const raw = /^[rR](["'])(-*)([([{])/.exec(text.slice(i, i + 40));
    if (raw) {
      const closer = { "(": ")", "[": "]", "{": "}" }[raw[3]] + raw[2] + raw[1];
      const end = text.indexOf(closer, i + raw[0].length);
      const stop = end === -1 ? text.length : end + closer.length;
      const startLine = line;
      for (let j = i; j < stop; j += 1) if (text[j] === "\n") line += 1;
      tokens.push({ kind: "value", text: "raw string", line: startLine, end: line });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const startLine = line;
      i += 1;
      while (i < text.length && text[i] !== ch) {
        // An escaped character is skipped, and still counted when it is a
        // newline, as a backslash at the end of a line inside a string is.
        if (text[i] === "\\") i += 1;
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 1;
      // A backtick quoted name behaves like a word, a string like a value.
      tokens.push({ kind: ch === "`" ? "word" : "value", text: ch, line: startLine, end: line });
      continue;
    }
    if ("([{".includes(ch)) {
      tokens.push({ kind: "open", text: ch, line, end: line });
      i += 1;
      continue;
    }
    if (")]}".includes(ch)) {
      tokens.push({ kind: "close", text: ch, line, end: line });
      i += 1;
      continue;
    }
    if (ch === "%") {
      const end = text.indexOf("%", i + 1);
      const stop = end === -1 || text.slice(i, end).includes("\n") ? i + 1 : end + 1;
      tokens.push({ kind: "op", text: "%op%", line, end: line });
      i = stop;
      continue;
    }
    const word = /^(?:[A-Za-z.][A-Za-z0-9._]*|[0-9][0-9.eExXa-fA-FLi]*)/.exec(text.slice(i));
    if (word) {
      const isNumber = /^[0-9]/.test(word[0]) || /^\.[0-9]/.test(word[0]);
      tokens.push({ kind: isNumber ? "value" : "word", text: word[0], line, end: line });
      i += word[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i)) ?? ch;
    tokens.push({ kind: "op", text: op, line, end: line });
    i += op.length;
  }
  return tokens;
}

/** Every top level statement as an inclusive range of zero based lines. */
export function statementRanges(text: string): LineRange[] {
  const tokens = tokenize(text);
  const ranges: LineRange[] = [];
  let start = -1;
  let depth = 0;
  // Parallel to the bracket stack: whether each open paren is a header.
  const headerStack: boolean[] = [];
  let pending = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];

    if (start === -1) {
      // An `else` on its own line belongs to the if before it. R refuses
      // this at the top level, but people write it, so it runs together.
      if (token.text === "else" && ranges.length) {
        start = ranges.pop()!.from;
      } else {
        start = token.line;
      }
    }

    if (token.kind === "open") {
      headerStack.push(token.text === "(" && previous !== undefined && HEADERS.has(previous.text) && previous.kind === "word");
      depth += 1;
    } else if (token.kind === "close") {
      const wasHeader = headerStack.pop() ?? false;
      depth = Math.max(0, depth - 1);
      pending = depth === 0 && wasHeader;
    } else {
      pending = depth === 0 && ((token.kind === "op" && CONTINUES.has(token.text)) || (token.kind === "word" && NEEDS_BODY.has(token.text)));
      if (token.kind === "op" && token.text === "%op%") pending = depth === 0;
    }

    const endsLine = next === undefined || next.line > token.end;
    if (endsLine && depth === 0 && !pending) {
      // A newline after a complete statement ends it.
      ranges.push({ from: start, to: token.end });
      start = -1;
    }
  }
  if (start !== -1 && tokens.length) ranges.push({ from: start, to: tokens[tokens.length - 1].end });
  return ranges;
}

/**
 * The statement to run for a cursor on `line`: the one containing it, or
 * when the cursor sits on a blank or comment line, the next one below.
 */
export function statementAt(ranges: LineRange[], line: number): LineRange | null {
  return ranges.find((range) => line >= range.from && line <= range.to) ?? ranges.find((range) => range.from > line) ?? null;
}
