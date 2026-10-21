// Where an object came from, and what depends on it, read from the script.
//
// In a long analysis, a data frame is made in one place and changed in
// several others: rows dropped, a column added, a type fixed. When a result
// looks wrong, the question is which of those lines did it, and after a
// fix, which lines have to run again. This reads each top level statement
// for the names it makes or changes and the names it reads, so both
// questions have an answer: the chain of lines behind an object, and the
// lines after it that use it, directly or through something else.
//
// It reads code as text and depends only on the tokenizers, so it can be
// tested alone. It sees the one script it is given, not the R prompt.

import { tokenize } from "./shinyCheck";
import { statementRanges } from "./statements";

/** One statement: its lines, counted from zero, and what it does with
 * names. `makes` holds names assigned whole, `changes` names modified in
 * part, such as df$x <- or names(df) <-, and `columns` the columns it adds
 * or replaces, by the object they belong to. */
export type Step = { from: number; to: number; code: string; makes: string[]; changes: string[]; reads: string[]; columns: Record<string, string[]> };

type Token = ReturnType<typeof tokenize>[number];

const KEYWORDS = new Set(["if", "else", "for", "in", "while", "repeat", "function", "return", "next", "break", "TRUE", "FALSE", "NULL", "NA", "Inf", "NaN", "T", "F"]);
// Calls whose named arguments are new or replaced columns of their data.
const COLUMN_MAKERS = new Set(["mutate", "transform", "within", "transmute"]);
const ASSIGN = new Set(["<-", "=", "<<-"]);

/** The names a statement assigns, and the columns it sets, from its
 * tokens: x <- ..., x$col <- ..., x[...] <- ..., names(x) <- ..., and
 * ... -> x. data(name) counts as making name. */
function writes(tokens: Token[]): { makes: string[]; changes: string[]; columns: Record<string, string[]> } {
  const makes: string[] = [];
  const changes: string[] = [];
  const columns: Record<string, string[]> = {};
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  const addColumn = (name: string, column: string) => (columns[name] ??= []).includes(column) || columns[name].push(column);
  // The left side runs to the first top level assignment.
  let depth = 0;
  let assign = -1;
  for (let k = 0; k < tokens.length; k += 1) {
    if (isOp(k, "(") || isOp(k, "[") || isOp(k, "{")) depth += 1;
    else if (isOp(k, ")") || isOp(k, "]") || isOp(k, "}")) depth -= 1;
    else if (depth === 0 && tokens[k].kind === "op" && ASSIGN.has(tokens[k].text)) {
      assign = k;
      break;
    }
  }
  if (assign > 0 && tokens[0].kind === "ident") {
    if (assign === 1) makes.push(tokens[0].text);
    else if (isOp(1, "(") && tokens[2]?.kind === "ident") {
      // A replacement call such as names(df) <- or levels(df$x) <-.
      changes.push(tokens[2].text);
      if (isOp(3, "$") && tokens[4]?.kind === "ident") addColumn(tokens[2].text, tokens[4].text);
    } else {
      changes.push(tokens[0].text);
      if (isOp(1, "$") && tokens[2]?.kind !== undefined) addColumn(tokens[0].text, tokens[2].value);
      if (isOp(1, "[") && isOp(2, "[") && tokens[3]?.kind === "string") addColumn(tokens[0].text, tokens[3].value);
    }
  }
  const last = tokens.length - 1;
  if (tokens[last]?.kind === "ident" && (isOp(last - 1, "->") || isOp(last - 1, "->>"))) makes.push(tokens[last].text);
  if (tokens[0]?.text === "data" && isOp(1, "(") && tokens[2]?.kind === "ident" && isOp(3, ")")) makes.push(tokens[2].text);
  // Columns made inside mutate() and its relatives, by the object assigned.
  const target = makes[0] ?? changes[0];
  if (target) {
    for (let k = 0; k < tokens.length; k += 1) {
      if (tokens[k].kind !== "ident" || !COLUMN_MAKERS.has(tokens[k].text) || !isOp(k + 1, "(")) continue;
      let inner = 0;
      for (let j = k + 1; j < tokens.length; j += 1) {
        if (isOp(j, "(")) inner += 1;
        else if (isOp(j, ")")) {
          inner -= 1;
          if (inner === 0) break;
        } else if (inner === 1 && tokens[j].kind === "ident" && isOp(j + 1, "=") && (isOp(j - 1, "(") || isOp(j - 1, ","))) addColumn(target, tokens[j].text);
      }
    }
  }
  return { makes, changes, columns };
}

/** The names a statement reads: every name that is not a function being
 * called, a column after $, an argument name, a package, or a keyword. */
function reads(tokens: Token[]): string[] {
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  const found: string[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.kind !== "ident" || KEYWORDS.has(token.text)) continue;
    if (isOp(k - 1, "$") || isOp(k - 1, "@") || isOp(k - 1, "::") || isOp(k - 1, ":::")) continue;
    if (isOp(k + 1, "::") || isOp(k + 1, ":::") || isOp(k + 1, "(")) continue;
    if (isOp(k + 1, "=") && (isOp(k - 1, "(") || isOp(k - 1, ","))) continue;
    // The name being assigned whole is written, not read.
    if (k === 0 && (isOp(1, "<-") || isOp(1, "=") || isOp(1, "<<-"))) continue;
    if (!found.includes(token.text)) found.push(token.text);
  }
  return found;
}

/** Every top level statement of a script, with what it makes, changes,
 * and reads. Prose in a document should be blanked out first. */
export function scriptSteps(code: string): Step[] {
  const lines = code.split("\n");
  const tokens = tokenize(code);
  return statementRanges(code).map((range) => {
    const own = tokens.filter((token) => token.line >= range.from && token.line <= range.to);
    const written = writes(own);
    return { from: range.from, to: range.to, code: lines.slice(range.from, range.to + 1).join("\n"), ...written, reads: reads(own) };
  });
}

/** Whether a step makes or changes a name. */
export function touches(step: Step, name: string) {
  return step.makes.includes(name) || step.changes.includes(name);
}

/** The steps behind a name, first to last: where it was made and each
 * change after, up to `before` when given, a line counted from zero. */
export function stepsBehind(steps: Step[], name: string, before = Infinity): Step[] {
  const mine = steps.filter((step) => step.from < before && touches(step, name));
  // Only the latest making counts, with the changes after it, since a name
  // made again starts over.
  const lastMade = mine.map((step) => step.makes.includes(name)).lastIndexOf(true);
  return lastMade > 0 ? mine.slice(lastMade) : mine;
}

/** The names a chain of steps was made from, other than the name itself,
 * in the order they first appear. */
export function inputsOf(chain: Step[], name: string): string[] {
  const inputs: string[] = [];
  for (const step of chain) for (const read of step.reads) if (read !== name && !inputs.includes(read)) inputs.push(read);
  return inputs;
}

/** The steps after `after`, a line counted from zero, that use a name,
 * directly or through something made from it. These are the lines to run
 * again after the name changes. */
export function stepsAfter(steps: Step[], name: string, after: number): Step[] {
  const tainted = new Set([name]);
  const found: Step[] = [];
  for (const step of steps) {
    if (step.from <= after) continue;
    if (step.reads.some((read) => tainted.has(read)) || step.changes.some((changed) => tainted.has(changed))) {
      found.push(step);
      for (const made of [...step.makes, ...step.changes]) tainted.add(made);
    } else {
      // Made again from nothing it depends on, so later uses no longer do.
      for (const made of step.makes) tainted.delete(made);
    }
  }
  return found;
}

/** The lines a statement needs before it can run, first to last: the
 * packages loaded before it, and for each name it reads, the steps behind
 * that name and, in turn, behind the names those were made from. A name
 * made only from files or built in data, with nothing else in the script
 * behind it, is a root: a sample of it can stand in for its steps. */
export function stepsLeadingTo(steps: Step[], reads: string[], before: number): { steps: Step[]; roots: Record<string, Step[]> } {
  const needed = new Set<Step>();
  const roots: Record<string, Step[]> = {};
  const seen = new Set<string>();
  // A name can be needed again from an earlier line, after it was made
  // again in between, so each name is followed once per starting line.
  const visit = (name: string, upTo: number) => {
    if (seen.has(`${name}@${upTo}`)) return;
    seen.add(`${name}@${upTo}`);
    const chain = stepsBehind(steps, name, upTo);
    if (!chain.length) return;
    for (const step of chain) needed.add(step);
    const inputs = inputsOf(chain, name).filter((input) => steps.some((step) => step.from < chain[0].from && touches(step, input)));
    if (!inputs.length) roots[name] = chain;
    for (const input of inputs) visit(input, chain[0].from);
  };
  for (const name of reads) visit(name, before);
  for (const step of steps) if (step.from < before && /^\s*(library|require|suppressPackageStartupMessages)\s*\(/.test(step.code)) needed.add(step);
  return { steps: [...needed].sort((a, b) => a.from - b.from), roots };
}
