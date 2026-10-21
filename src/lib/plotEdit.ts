// Changing a plot's title, axis labels, and color by changing the code
// that drew it.
//
// People often want to fix a label on a plot they can see and do not know
// which argument does it, or that ggplot2 wants labs(). Editing the
// picture alone would be lost the next time the script runs, so this
// edits the code instead: main, xlab, ylab, and col for base R plots, and
// labs() for ggplot2. What it cannot read for sure, such as a color mapped
// from the data, it leaves alone and does not offer.
//
// It depends on nothing but the tokenizer, so it can be tested alone.

import { tokenize } from "./shinyCheck";

export type PlotLabels = { title: string; x: string; y: string; color: string };

/** Which kind of plot code a statement is, if any this can edit. */
export type PlotKind = { kind: "base"; call: string; colorEditable: boolean } | { kind: "ggplot" };

type Token = ReturnType<typeof tokenize>[number];

// Base R plotting calls whose labels are main, xlab, and ylab.
const BASE_CALLS = new Set(["plot", "hist", "barplot", "boxplot", "stripchart", "dotchart"]);

/** Character offsets in the code for each token, since tokens count lines
 * and columns. */
function offsets(code: string) {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) if (code[i] === "\n") starts.push(i + 1);
  return (line: number, col: number) => starts[line] + col;
}

/** The arguments of the call opening at token `open`, by name, with where
 * each value starts and ends, and where the call closes. */
function callArgs(tokens: Token[], open: number) {
  const named = new Map<string, { from: number; to: number }>();
  let depth = 0;
  let k = open;
  let argStart = open + 1;
  let positional = 0;
  const firstArg: { from: number; to: number }[] = [];
  for (; k < tokens.length; k += 1) {
    const text = tokens[k].kind === "op" ? tokens[k].text : "";
    if (text === "(" || text === "[" || text === "{") depth += 1;
    else if (text === ")" || text === "]" || text === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 1 && text === ",") {
      record(argStart, k - 1);
      argStart = k + 1;
    }
  }
  record(argStart, k - 1);
  function record(from: number, to: number) {
    if (from > to) return;
    if (tokens[from].kind === "ident" && tokens[from + 1]?.text === "=" && from + 2 <= to) named.set(tokens[from].text, { from: from + 2, to });
    else {
      if (positional === 0) firstArg.push({ from, to });
      positional += 1;
    }
  }
  return { named, close: k, first: firstArg[0] };
}

/** The plot code a statement holds, when this can edit it. */
export function plotKind(code: string): PlotKind | null {
  const tokens = tokenize(code);
  if (tokens.some((token, k) => token.text === "ggplot" && tokens[k + 1]?.text === "(")) return { kind: "ggplot" };
  const k = tokens.findIndex((token, at) => token.kind === "ident" && BASE_CALLS.has(token.text) && tokens[at + 1]?.text === "(" && tokens[at - 1]?.text !== "$");
  if (k < 0) return null;
  const { named } = callArgs(tokens, k + 1);
  const col = named.get("col");
  // A color given as one quoted value can be changed. One mapped from the
  // data, such as col = species, would change what the plot shows.
  const colorEditable = !col || (col.from === col.to && tokens[col.from].kind === "string");
  return { kind: "base", call: tokens[k].text, colorEditable };
}

/** The value of a string argument, unquoted, or empty when it is missing
 * or not a plain string. */
function stringAt(tokens: Token[], span: { from: number; to: number } | undefined) {
  return span && span.from === span.to && tokens[span.from].kind === "string" ? tokens[span.from].value : "";
}

/** The labels a statement sets now, as far as they can be read. */
export function readLabels(code: string): PlotLabels {
  const tokens = tokenize(code);
  const kind = plotKind(code);
  const labels: PlotLabels = { title: "", x: "", y: "", color: "" };
  if (!kind) return labels;
  if (kind.kind === "base") {
    const k = tokens.findIndex((token, at) => token.text === kind.call && tokens[at + 1]?.text === "(");
    const { named } = callArgs(tokens, k + 1);
    return { title: stringAt(tokens, named.get("main")), x: stringAt(tokens, named.get("xlab")), y: stringAt(tokens, named.get("ylab")), color: stringAt(tokens, named.get("col")) };
  }
  for (let k = 0; k < tokens.length; k += 1) {
    if (tokens[k + 1]?.text !== "(") continue;
    const { named, first } = callArgs(tokens, k + 1);
    if (tokens[k].text === "labs") {
      labels.title = stringAt(tokens, named.get("title")) || labels.title;
      labels.x = stringAt(tokens, named.get("x")) || labels.x;
      labels.y = stringAt(tokens, named.get("y")) || labels.y;
    } else if (tokens[k].text === "ggtitle") labels.title = stringAt(tokens, first) || labels.title;
    else if (tokens[k].text === "xlab") labels.x = stringAt(tokens, first) || labels.x;
    else if (tokens[k].text === "ylab") labels.y = stringAt(tokens, first) || labels.y;
  }
  return labels;
}

/** Text quoted as an R string. */
function quote(text: string) {
  return JSON.stringify(text);
}

/** Applies edits from the end of the code backward, so earlier offsets
 * stay right. */
function applyEdits(code: string, edits: { from: number; to: number; text: string }[]) {
  let out = code;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
  return out;
}

/**
 * Sets the labels, and for a base R plot its color, in the code. An empty
 * label removes the argument, so the plot goes back to its default.
 */
export function writeLabels(code: string, labels: PlotLabels): string {
  const tokens = tokenize(code);
  const at = offsets(code);
  const kind = plotKind(code);
  if (!kind) return code;
  const edits: { from: number; to: number; text: string }[] = [];
  const startOf = (token: Token) => at(token.line, token.col);
  const endOf = (token: Token) => at(token.line, token.end);

  /** Sets one named argument inside a call: replaced, added, or removed. */
  const setArg = (named: Map<string, { from: number; to: number }>, name: string, value: string, adds: string[]) => {
    const span = named.get(name);
    if (!span) {
      if (value) adds.push(`${name} = ${quote(value)}`);
      return;
    }
    if (value) {
      edits.push({ from: startOf(tokens[span.from]), to: endOf(tokens[span.to]), text: quote(value) });
      return;
    }
    // Removing an argument takes one comma with it: the one before it, or
    // the one after it when it comes first.
    const nameAt = span.from - 2;
    if (tokens[nameAt - 1]?.text === ",") edits.push({ from: endOf(tokens[nameAt - 2]), to: endOf(tokens[span.to]), text: "" });
    else {
      const after = tokens[span.to + 1]?.text === "," ? startOf(tokens[span.to + 2]) : endOf(tokens[span.to]);
      edits.push({ from: startOf(tokens[nameAt]), to: after, text: "" });
    }
  };

  if (kind.kind === "base") {
    const k = tokens.findIndex((token, index) => token.text === kind.call && tokens[index + 1]?.text === "(");
    const { named, close } = callArgs(tokens, k + 1);
    const adds: string[] = [];
    setArg(named, "main", labels.title, adds);
    setArg(named, "xlab", labels.x, adds);
    setArg(named, "ylab", labels.y, adds);
    if (kind.colorEditable) setArg(named, "col", labels.color, adds);
    if (adds.length) {
      const empty = tokens[close - 1]?.text === "(";
      edits.push({ from: startOf(tokens[close]), to: startOf(tokens[close]), text: `${empty ? "" : ", "}${adds.join(", ")}` });
    }
    return applyEdits(code, edits);
  }

  // ggplot2: labels already set by labs, ggtitle, xlab, or ylab are changed
  // where they are. Anything new goes into one labs() at the end.
  const wanted: [keyof PlotLabels, string, string][] = [
    ["title", "title", "ggtitle"],
    ["x", "x", "xlab"],
    ["y", "y", "ylab"],
  ];
  const handled = new Set<string>();
  let labsCall: { named: Map<string, { from: number; to: number }>; close: number } | null = null;
  for (let k = 0; k < tokens.length; k += 1) {
    if (tokens[k + 1]?.text !== "(") continue;
    const name = tokens[k].text;
    const { named, close, first } = callArgs(tokens, k + 1);
    if (name === "labs") labsCall = { named, close };
    for (const [key, , single] of wanted) {
      if (name === single && first && !handled.has(key)) {
        handled.add(key);
        if (labels[key]) edits.push({ from: startOf(tokens[first.from]), to: endOf(tokens[first.to]), text: quote(labels[key]) });
        else {
          // An emptied ggtitle() or xlab() goes, with the + before it.
          const plus = tokens[k - 1]?.text === "+" ? k - 1 : k;
          edits.push({ from: plus === k ? startOf(tokens[k]) : endOf(tokens[plus - 1]), to: endOf(tokens[close]), text: "" });
        }
      }
    }
  }
  const adds: string[] = [];
  for (const [key, argument] of wanted) {
    if (handled.has(key)) continue;
    if (labsCall) setArg(labsCall.named, argument, labels[key], adds);
    else if (labels[key]) adds.push(`${argument} = ${quote(labels[key])}`);
  }
  if (adds.length && labsCall) {
    const empty = tokens[labsCall.close - 1]?.text === "(";
    edits.push({ from: startOf(tokens[labsCall.close]), to: startOf(tokens[labsCall.close]), text: `${empty ? "" : ", "}${adds.join(", ")}` });
  } else if (adds.length) {
    const indent = /^(\s*)/.exec(code.split("\n")[1] ?? "")?.[1] || "  ";
    edits.push({ from: code.replace(/\s+$/, "").length, to: code.replace(/\s+$/, "").length, text: ` +\n${indent}labs(${adds.join(", ")})` });
  }
  return applyEdits(code, edits);
}
