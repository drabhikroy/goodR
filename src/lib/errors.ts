// Restates R's errors in plain words, points to the exact spot in the code
// that went wrong, and says what to try next. Where the fix is clear, it is
// offered as one button.
//
// R's own messages are written for people who already know R. They name
// internal functions, quote jargon such as "closure" and "binary operator",
// and rarely say which part of a line failed. Each message here has three
// parts, in this order: a short headline that says what happened, a plain
// explanation of why, and one thing to try. The original message is always
// kept and one click away. Studies of rewritten compiler messages show mixed
// results (Becker et al. 2019), so the plain version adds location and a
// likely fix rather than replacing what R said. Locating the failing spot
// follows the finding that people repair errors faster when the message
// points at the code than when it only describes the problem (Marceau,
// Fisler, and Krishnamurthi 2011).

import type { RObject } from "./types";

export type Fix =
  | { kind: "replace"; from: string; to: string; label: string }
  | { kind: "install"; name: string; label: string };

/** The spot that failed, within the statement that ran. `line` counts from
 * zero at the statement's first line. Columns count from zero, and `to` is
 * just past the last marked character. */
export type Where = { line: number; from: number; to: number };

export type Explained = {
  /** One short sentence saying what happened. */
  title: string;
  /** Why it happened, in everyday words. */
  detail: string;
  /** One thing to try, when there is a likely one. */
  hint?: string;
  fix?: Fix;
  original: string;
  /** The part of the code that failed, when it can be found. */
  where: Where | null;
};

/** Strips the "Error in call :" framing ark and R put around a message. */
export function cleanMessage(message: string): string {
  return message
    .replace(/^Error(?: in [^:]+?)?\s*:\s*/s, "")
    .replace(/^\n+/, "")
    .trim();
}

/** Removes terminal color codes, which tracebacks carry. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * The calls in a traceback that came from the person's code, in order from
 * outermost to innermost. ark lists them as "1. lm(y ~ x)". Its own error
 * handler and R's stop() are left out, since they say nothing about where
 * the person's code went wrong.
 */
export function userFrames(traceback: string[]): string[] {
  return traceback
    .map(plain)
    .map((frame) => frame.replace(/^\s*\d+\.\s*/, ""))
    .filter((frame) => frame && !/^\(function \(cnd\)/.test(frame) && !/^(handle_error_base|stop|stopifnot|abort|rlang::abort)\(/.test(frame));
}

/**
 * The function an error came from. R sometimes says so in the message, as
 * in "Error in lm.fit(x, y) :", and ark lists the calls in its traceback.
 * With the code at hand, the innermost call that appears in the code is
 * chosen, since that is the part the person wrote and can change. lm.fit
 * is inside lm, and only lm is in the script.
 */
export function callName(message: string, traceback: string[] = [], code = ""): string | undefined {
  const named = /Error in [`'‘]?([A-Za-z.][\w.]*(?:::[A-Za-z.][\w.]*)?)(?:\(|[`'’]|\s*:)/.exec(plain(message))?.[1];
  const frames = userFrames(traceback)
    .map((frame) => /^([A-Za-z.][\w.]*(?:::[A-Za-z.][\w.]*)?)\(/.exec(frame)?.[1])
    .filter((name): name is string => Boolean(name));
  const candidates = [...(named ? [named] : []), ...[...frames].reverse()];
  if (code) {
    const inCode = candidates.find((name) => findCall(code, name));
    if (inCode) return inCode;
  }
  return named ?? frames[0];
}

/** Edit distance, used to suggest the name someone probably meant. */
export function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      // Swapped neighbors count as one edit, the most common typo.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/**
 * The closest known name, or nothing when no name is close enough to be a
 * likely typo. Shared prefixes count as a match too, since people often
 * shorten or lengthen a column name ("flipper_length_mm" for "flipper_len").
 */
export function closestName(name: string, candidates: string[]): string | undefined {
  let best: { candidate: string; score: number } | undefined;
  for (const candidate of new Set(candidates)) {
    if (candidate === name) continue;
    let score = distance(name.toLowerCase(), candidate.toLowerCase());
    const shorter = Math.min(name.length, candidate.length);
    if (shorter >= 4 && (name.startsWith(candidate) || candidate.startsWith(name))) score = Math.min(score, 1.5);
    const limit = Math.max(2, Math.floor(name.length / 3));
    if (score <= limit && (!best || score < best.score)) best = { candidate, score };
  }
  return best?.candidate;
}

/**
 * The code with the insides of strings and comments blanked to spaces, so a
 * search for a name never lands on a word that is only text. Every
 * character keeps its place, so positions found here are positions in the
 * original.
 */
export function maskText(code: string): string {
  const out = code.split("");
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "#") {
      while (i < code.length && code[i] !== "\n") out[i++] = " ";
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < code.length && code[i] !== ch) {
        if (code[i] === "\\" && i + 1 < code.length) out[i++] = " ";
        if (code[i] !== "\n") out[i] = " ";
        i += 1;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

/** Turns an offset in the code into a line and column. */
function place(code: string, offset: number): { line: number; column: number } {
  const before = code.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before[before.length - 1].length };
}

function span(code: string, start: number, length: number): Where {
  const { line, column } = place(code, start);
  return { line, from: column, to: column + Math.max(1, length) };
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first use of a name in the code, as a whole word and not as text. */
export function findName(code: string, name: string): Where | null {
  const masked = maskText(code);
  const found = new RegExp(`(?<![\\w.$@])${escape(name)}(?![\\w.])`).exec(masked);
  return found ? span(code, found.index, name.length) : null;
}

/** The first call to a function, marking its name. */
export function findCall(code: string, name: string): Where | null {
  const masked = maskText(code);
  const found = new RegExp(`(?<![\\w.$@])${escape(name)}\\s*\\(`).exec(masked);
  return found ? span(code, found.index, name.length) : null;
}

/**
 * An operator or symbol, marked only when it appears exactly once. With
 * several candidates there is no way to tell which one failed, and marking
 * the wrong one would mislead, so the whole statement is shown instead.
 */
function findOnly(code: string, pattern: RegExp): Where | null {
  const masked = maskText(code);
  const hits = [...masked.matchAll(new RegExp(pattern.source, "g"))];
  return hits.length === 1 ? span(code, hits[0].index ?? 0, hits[0][0].length) : null;
}

/** The first use of a named operator such as %>%, which is always a clear
 * place to point. */
function findOperator(code: string, symbol: string): Where | null {
  const index = maskText(code).indexOf(symbol);
  return index >= 0 ? span(code, index, symbol.length) : null;
}

/** The token that covers a column of one line, for parse errors that give
 * a position. */
function tokenAt(code: string, line: number, column: number): Where | null {
  const text = code.split("\n")[line];
  if (text === undefined || !text.length) return null;
  const at = Math.min(Math.max(0, column), text.length - 1);
  const wordy = /[\w.]/;
  if (wordy.test(text[at])) {
    let from = at;
    let to = at + 1;
    while (from > 0 && wordy.test(text[from - 1])) from -= 1;
    while (to < text.length && wordy.test(text[to])) to += 1;
    return { line, from, to };
  }
  // A string constant: find the quoted piece that covers the position.
  let open = -1;
  let quoteChar = "";
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (open >= 0) {
      if (ch === "\\") index += 1;
      else if (ch === quoteChar) {
        if (at >= open && at <= index) return { line, from: open, to: index + 1 };
        open = -1;
      }
    } else if (ch === '"' || ch === "'") {
      open = index;
      quoteChar = ch;
    }
  }
  return { line, from: at, to: at + 1 };
}

/** The end of the code, where an unfinished statement stopped. */
function endOfCode(code: string): Where | null {
  const trimmed = code.replace(/\s+$/, "");
  if (!trimmed) return null;
  return span(code, trimmed.length - 1, 1);
}

/** Finds the token R named in "unexpected symbol in "x y"", which quotes the
 * code up to and including the offending token. */
function findSnippetEnd(code: string, snippet: string): Where | null {
  const text = snippet.trim();
  if (!text) return null;
  const tail = /([\w.]+|"[^"]*"?|'[^']*'?|\S)$/.exec(text)?.[1] ?? "";
  if (!tail) return null;
  // R quotes the code from the start of the statement, so the quoted text
  // appears in the code and its last token is the one that failed.
  const start = code.indexOf(text);
  if (start >= 0) return span(code, start + text.length - tail.length, tail.length);
  // A long quote is cut short by R, so fall back to its last line.
  const lastLine = text.split("\n").pop()?.trim() ?? "";
  const at = lastLine ? code.indexOf(lastLine) : -1;
  return at >= 0 ? span(code, at + lastLine.length - tail.length, tail.length) : null;
}

type Rule = {
  test: RegExp;
  make: (match: RegExpExecArray, ctx: { code: string; objects: RObject[]; call?: string }) => Omit<Explained, "original" | "where"> & { where?: Where | null };
};

const quote = (name: string) => `“${name}”`;

const UNEXPECTED_HINT = "Look just before the marked spot for a missing comma, a missing operator such as + or <-, or a missing line break.";

// The rules, grouped by what went wrong. The first rule that matches wins,
// so the specific wording of a parse error comes before the general one.
// Each headline names the thing in the person's terms, and each hint is one
// step the person can take now.
const RULES: Rule[] = [
  // Names R could not find: objects, packages, and functions.
  {
    test: /object '([^']+)' not found/,
    make: ([, name], { code, objects }) => {
      const names = objects.flatMap((object) => [object.name, ...object.columns]);
      const match = closestName(name, names);
      return {
        title: `R could not find ${quote(name)}`,
        detail: match ? `There is no object named ${name}. The closest match is ${match}.` : `There is no object named ${name}. It may be misspelled, or the line that creates it may not have run yet.`,
        hint: match ? undefined : "Check the spelling. R treats Data and data as different names. Then run the line that creates it, above this one.",
        fix: match ? { kind: "replace", from: name, to: match, label: `Use ${match}` } : undefined,
        where: findName(code, name),
      };
    },
  },
  {
    test: /there is no package called [‘'"]([^’'"]+)[’'"]/,
    make: ([, name]) => ({
      title: `The package ${quote(name)} is not installed yet`,
      detail: `A package is a set of extra tools for R. ${name} is not on this computer yet, so R cannot use it.`,
      hint: "Install it once with the button below. After that it stays installed.",
      fix: { kind: "install", name, label: `Install ${name}` },
    }),
  },
  {
    test: /could not find function "([^"]+)"/,
    make: ([, name], { code }) => ({
      title: `R does not know a function called ${quote(name)}`,
      detail:
        name === "%>%"
          ? "The %>% pipe comes from a package, such as dplyr or magrittr, and that package is not loaded."
          : "Either the name is misspelled, or the function comes from a package that has not been loaded in this session.",
      hint: name === "%>%" ? "Add library(dplyr) above this line, or use R's built in pipe, which looks like |>." : `If ${name} comes from a package, add library(packagename) above this line. Otherwise check the spelling.`,
      where: name.startsWith("%") ? findOperator(code, name) : findCall(code, name),
    }),
  },
  // Parse errors. These carry a position when R's parser is asked. R stops at
  // the first thing it cannot read, which is often just after the real
  // mistake, so the hints point a little before the marked spot.
  {
    test: /unexpected end of input|parse incomplete input/,
    make: (_match, { code }) => ({
      title: "The code stops before it is finished",
      detail: "A bracket, a brace, or a quote was opened and never closed, so R is still waiting for the rest.",
      hint: "Check the end of the statement for a missing ) or } or closing quote.",
      where: endOfCode(code),
    }),
  },
  {
    test: /unexpected '?else'?/,
    make: (_match, { code }) => ({
      title: "R did not expect the word else here",
      detail: "In a script, else has to start on the same line as the closing brace of the if before it. On its own line, R reads the if as finished.",
      hint: "Move else up so the line reads } else {.",
      where: findName(code, "else"),
    }),
  },
  {
    test: /unexpected symbol/,
    make: () => ({
      title: "R did not expect a name here",
      detail: "Two names or values sit side by side with nothing between them. R needs a comma, an operator, or a new line to tell where one ends and the next begins.",
      hint: UNEXPECTED_HINT,
    }),
  },
  {
    test: /unexpected (?:numeric constant|string constant)/,
    make: (match) => ({
      title: match[0].includes("string") ? "R did not expect a piece of text here" : "R did not expect a number here",
      detail: match[0].includes("string") ? "A piece of text in quotes follows another value with nothing between them." : "A number follows another value with nothing between them.",
      hint: `${UNEXPECTED_HINT} A quote opened earlier and never closed can also cause this.`,
    }),
  },
  {
    test: /unexpected '([)\]}])'/,
    make: ([, bracket]) => ({
      title: `This ${bracket} has no matching opening bracket`,
      detail: `A closing ${bracket} was found, but nothing was open to close. An extra one was probably typed, or its opening partner is missing.`,
      hint: "Count the brackets in the statement. Every ( needs a ), every [ needs a ], and every { needs a }.",
    }),
  },
  {
    test: /unexpected ','/,
    make: () => ({
      title: "R did not expect a comma here",
      detail: "A comma appears where R cannot use one. This often happens when an extra comma is left at the end of a list, or a value between two commas is missing.",
      hint: "Remove the extra comma, or put the missing value between the two commas.",
    }),
  },
  {
    test: /unexpected '='/,
    make: () => ({
      title: "R did not expect an equals sign here",
      detail: "An equals sign is allowed to set a function input, as in mean(x, na.rm = TRUE). It is not allowed in the middle of an expression.",
      hint: "To store a result, use <-. To compare two values, use == with two equals signs.",
    }),
  },
  {
    test: /unexpected input/,
    make: () => ({
      title: "R found a character it cannot read",
      detail: "This is often a curly quote or a special dash that came from a word processor or a web page. R only understands plain straight quotes.",
      hint: "Retype the quotes and dashes on the marked line.",
    }),
  },
  {
    test: /unexpected '?([^'\n]+)'?(?: in|$)/,
    make: ([, token]) => ({
      title: `R did not expect ${quote(token)} here`,
      detail: "R found something that cannot go in this spot. The code before it may be unfinished, or a symbol may be out of place.",
      hint: UNEXPECTED_HINT,
    }),
  },
  // Values of the wrong kind, such as text where numbers are needed.
  {
    test: /non-numeric argument to binary operator/,
    make: (_match, { code }) => ({
      title: "One side of the math is not a number",
      detail: "R tried to do arithmetic with something that is text, a category (a factor), or a list. Arithmetic works only on numbers.",
      hint: "Check the values on each side of the operator. A column read from a file as text can be turned into numbers with as.numeric().",
      where: findOnly(code, /[+*/^]|(?<![<-])-(?!>)/),
    }),
  },
  {
    test: /non-numeric argument to mathematical function/,
    make: (_match, { call }) => ({
      title: "A math function was given something that is not a number",
      detail: `${call ? `${call}()` : "The function"} works only on numbers, and it received text or a category.`,
      hint: "Check what you passed in. as.numeric() turns text that looks like numbers into numbers.",
    }),
  },
  {
    test: /invalid 'type' \((\w+)\) of argument/,
    make: ([, type], { call }) => ({
      title: type === "character" ? `${call ? `${call}()` : "This function"} was given text` : `${call ? `${call}()` : "This function"} was given the wrong kind of value`,
      detail: type === "character" ? "The function needs numbers, but it was given text. A column of numbers that was read from a file as text causes this." : `The function cannot work on a value of type ${type}.`,
      hint: "Check the column with class() or str(). Use as.numeric() to turn text into numbers.",
    }),
  },
  {
    test: /invalid argument to unary operator/,
    make: () => ({
      title: "A minus sign or an exclamation mark was put in front of text",
      detail: "Placing - or ! in front of a value means negate it, and that works only for numbers and TRUE or FALSE.",
      hint: "Check the value right after the marked sign. Text must be turned into numbers first.",
    }),
  },
  // Tables whose parts do not line up.
  {
    test: /arguments imply differing number of rows: ([\d, ]+)/,
    make: ([, counts]) => ({
      title: "The columns are not all the same length",
      detail: `A table needs every column to have the same number of values. The lengths given are ${counts.trim()}.`,
      hint: "Check each column you pass in. One of them has more or fewer values than the others.",
    }),
  },
  {
    test: /replacement has (\d+) rows?, data has (\d+)/,
    make: ([, got, wanted]) => ({
      title: "The new column is the wrong length",
      detail: `The table has ${wanted} rows, but the new column has ${got}. A column must have one value for every row, or a single value that R can repeat.`,
      hint: "Check how the new column is made. A filter earlier in the pipeline can remove rows.",
    }),
  },
  {
    test: /variable lengths differ \(found for '([^']+)'\)/,
    make: ([, name], { code }) => ({
      title: `${quote(name)} is a different length from the others`,
      detail: "A model or plot needs every variable to have one value for every row. These do not line up.",
      hint: "Check that all the variables come from the same table.",
      where: findName(code, name),
    }),
  },
  // Files R could not reach.
  {
    test: /cannot open file '([^']+)'|cannot open the connection|No such file or directory/,
    make: (match) => ({
      title: match[1] ? `R cannot find the file ${quote(match[1])}` : "R cannot open the file",
      detail: "Either the file is not where R is looking, or the name is spelled differently. R looks in the working folder, which is the folder of the script being run, unless the path says otherwise.",
      hint: "Check the spelling and the folder. The Import Data button lets you pick the file and writes the line for you.",
    }),
  },
  // Asking for a part of an object that is not there.
  {
    test: /undefined columns selected/,
    make: () => ({
      title: "A column in this line does not exist",
      detail: "The line asks for a column by name or number, and the table has no such column.",
      hint: "Run names(your_table) to see the real column names, and check the spelling and capital letters.",
    }),
  },
  {
    test: /subscript out of bounds/,
    make: () => ({
      title: "The line asks for a position that does not exist",
      detail: "An index is larger than the object it points into, such as asking for item 12 of a list that holds 10.",
      hint: "Check the number inside the square brackets against the size of the object. length() and nrow() give the sizes.",
    }),
  },
  {
    test: /incorrect number of dimensions/,
    make: () => ({
      title: "Too many or too few indexes were used",
      detail: "A table takes two indexes, rows and columns, as in data[1, 2]. A plain list of values takes only one.",
      hint: "Check whether the object is a table or a single list of values.",
    }),
  },
  {
    test: /\$ operator is invalid for atomic vectors/,
    make: (_match, { code }) => ({
      title: "The $ sign was used on something that has no columns",
      detail: "The $ sign picks a column out of a table, or an item out of a list. The object before it is a plain list of values, so it has nothing to pick.",
      hint: "Run the name before the $ on its own line to see what it holds.",
      where: findOnly(code, /\$/),
    }),
  },
  {
    test: /object of type 'closure' is not subsettable/,
    make: (_match, { code }) => ({
      title: "A function was used as if it were data",
      detail: "The name before the $ or the [ belongs to a function that R already has, such as data, df, or c. R found the function instead of your data.",
      hint: "Rename your data object, or check that the line that creates it ran.",
      where: findOnly(code, /\$|\[/),
    }),
  },
  // Function inputs that are missing, extra, or empty.
  {
    test: /argument "([^"]+)" is missing, with no default/,
    make: ([, name], { call, code }) => ({
      title: `${call ? `${call}()` : "The function"} needs a value for ${quote(name)}`,
      detail: `Every function has inputs it cannot work without. ${name} is one of them for this function, and none was given.`,
      hint: "Open the Help tab and look up the function to see what it expects.",
      where: call ? findCall(code, call) : null,
    }),
  },
  {
    test: /unused arguments? \(([^)]+)\)/,
    make: ([, args], { call, code }) => ({
      title: "The function was given an input it does not accept",
      detail: `The function has no input matching ${args}. The name may be misspelled, or it may belong to a different function.`,
      hint: "Open the Help tab and look up the function to see the inputs it accepts.",
      where: call ? findCall(code, call) : null,
    }),
  },
  // if tests that cannot decide.
  {
    test: /missing value where TRUE\/FALSE needed/,
    make: (_match, { code }) => ({
      title: "An if test got a missing value",
      detail: "An if needs a clear TRUE or FALSE. The test gave NA, which means a value it looked at is missing.",
      hint: "Check for missing values with is.na(), or remove them with na.omit() before the test.",
      where: findName(code, "if"),
    }),
  },
  {
    test: /the condition has length > 1/,
    make: (_match, { code }) => ({
      title: "An if test got more than one answer",
      detail: "An if checks a single TRUE or FALSE. This test checked many values at once and gave many answers.",
      hint: "Use any() or all() to boil the answers down to one, or use ifelse() to handle every value.",
      where: findName(code, "if"),
    }),
  },
  {
    test: /argument (\d+) is empty/,
    make: ([, position], { code }) => ({
      title: "A function input is empty",
      detail: `Input number ${position} has nothing in it. This usually means a comma was left with nothing after it, often at the end of a list of inputs.`,
      hint: "Remove the extra comma, or put the missing value after it.",
      where: findOnly(code, /,(?=\s*[,)])/),
    }),
  },
  {
    test: /non-conformable (?:arguments|arrays)/,
    make: () => ({
      title: "The two tables are not the same shape",
      detail: "Matrix math needs the sizes to fit together. Multiplying needs the first one's columns to equal the second one's rows, and adding needs the same shape.",
      hint: "Check each size with dim().",
    }),
  },
  // Plots and models.
  {
    test: /plot\.new has not been called yet/,
    make: (_match, { call, code }) => ({
      title: "There is no plot to add to",
      detail: "Lines such as abline, lines, points, text, and legend add to a plot that is already open. No plot is open right now.",
      hint: "Run the line that draws the plot first, such as plot() or hist(). Then run this one.",
      where: call ? findCall(code, call) : null,
    }),
  },
  {
    test: /need finite '([xy]lim)' values/,
    make: () => ({
      title: "The plot has nothing to show",
      detail: "R could not work out the plot range because the values are all missing or infinite.",
      hint: "Check the data you are plotting. Missing values show up with summary().",
    }),
  },
  {
    test: /0 \(non-NA\) cases/,
    make: () => ({
      title: "No row has complete data for this model",
      detail: "Every row is missing at least one of the values the model uses, so R left them all out and had nothing to work with.",
      hint: "Check how many values are missing with colSums(is.na(your_table)).",
    }),
  },
  {
    test: /contrasts can be applied only to factors with 2 or more levels/,
    make: () => ({
      title: "A grouping variable has only one value",
      detail: "A model compares groups, and one of the variables used has the same value in every row, so there is nothing to compare.",
      hint: "Check the variable with table(). If a filter removed the other groups, loosen it.",
    }),
  },
  {
    test: /'x' must be numeric/,
    make: (_match, { call }) => ({
      title: `${call ? `${call}()` : "This function"} needs numbers`,
      detail: "The values given are text or categories, and a histogram or similar chart needs numbers.",
      hint: "Check the column with class(). as.numeric() turns text that looks like numbers into numbers.",
    }),
  },
  // The computer itself.
  {
    test: /cannot allocate vector of size ([^\n]+)/,
    make: ([, size]) => ({
      title: "R ran out of memory",
      detail: `The step needed room for ${size.trim()} more, and the computer has no more to give R right now.`,
      hint: "Close other programs, work with fewer rows or columns, or restart R from the Run menu to free memory.",
    }),
  },
  {
    test: /invalid \(NULL\) left side of assignment/,
    make: () => ({
      title: "The thing being assigned to does not exist",
      detail: "The left side of <- names something R cannot store a value in, often a column that does not exist yet on an object that is empty.",
      hint: "Check the name on the left of the arrow.",
    }),
  },
];

/**
 * Explains an error in plain words. `code` is the statement that ran, so
 * the explanation can point at the part that failed, and `traceback` helps
 * name the function involved when R's message does not.
 */
export function explainError(message: string, objects: RObject[], code = "", traceback: string[] = [], parsed = ""): Explained {
  const original = cleanMessage(message);
  const call = callName(message, traceback, code);

  // Parse errors carry a position when R's parser is asked directly, as in
  // "<text>:2:5: unexpected symbol". The console's message leaves it out,
  // so `parsed` holds the parser's own words when the app asked for them.
  const positioned = /<text>:(\d+):(\d+):\s*unexpected/.exec(parsed) ?? /<text>:(\d+):(\d+):\s*unexpected/.exec(original);

  for (const rule of RULES) {
    const match = rule.test.exec(original);
    if (!match) continue;
    const made = rule.make(match, { code, objects, call });
    let where = made.where ?? null;
    if (!where && code) {
      if (positioned) where = tokenAt(code, Number(positioned[1]) - 1, Number(positioned[2]) - 1);
      const quoted = /unexpected [^"\n]* in "([\s\S]*?)"\s*$/m.exec(original);
      if (!where && quoted) where = findSnippetEnd(code, quoted[1]);
      // Without a better clue, the function R named is the best guess.
      if (!where && call) where = findCall(code, call);
    }
    return { title: made.title, detail: made.detail, hint: made.hint, fix: made.fix, where, original };
  }

  // A message with no plain version yet. R's words are kept and framed so the
  // person knows the line did not run and where to look.
  return {
    title: "R stopped with a message that has no plain version yet",
    detail: original ? `R said: ${original}` : "R stopped but gave no message.",
    hint: call ? `The message names ${call}(). Open the Help tab and look up ${call} to see what it expects.` : undefined,
    original,
    where: code && call ? findCall(code, call) : null,
  };
}

/** The plain version of an error as lines of text, with a row of carets
 * under the failing spot. The console, which has no card, uses this. */
export function describeProblem(explained: Explained, code: string): string {
  const lines = [explained.title, explained.detail];
  if (explained.where && code) {
    const text = code.split("\n")[explained.where.line] ?? "";
    lines.push(`  ${text}`, `  ${" ".repeat(explained.where.from)}${"^".repeat(Math.max(1, explained.where.to - explained.where.from))}`);
  }
  // Text in the console has no buttons, so a hint that points at one names
  // the code to type instead.
  const hint = explained.fix?.kind === "install" ? `Install it once by running install.packages("${explained.fix.name}"). After that it stays installed.` : explained.hint;
  if (hint) lines.push(`Try this: ${hint}`);
  return lines.join("\n");
}
