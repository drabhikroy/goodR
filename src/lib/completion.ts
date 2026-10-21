// Code completion from R itself. R ships the completion engine that its own
// console and RStudio rely on, in the utils package. It knows the objects in
// the session, the functions in attached packages, a function's argument
// names inside its parentheses, a data frame's columns after a dollar
// sign, and the exports of a package after two colons. Asking it, rather
// than guessing from the text, means suggestions match what R will run.

import { acceptCompletion, autocompletion, completionStatus, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { indentMore } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

/** What R suggests: where the word being completed starts on the line, and
 * the candidates with what kind of thing each one is. */
export type Completions = { start: number; items: { name: string; kind: string }[] };

type Completer = (text: string, cursor: number) => Promise<Completions | null>;
let ask: Completer = async () => null;

/** Set by the app, which knows how to reach R. */
export function setCompleter(next: Completer) {
  ask = next;
}

// The characters that can make up a name R completes, including the dollar
// sign, the at sign, and the colons of pkg::name.
const NAME = /[A-Za-z0-9._$@:]*$/;

/** CodeMirror's completion types decide each suggestion's icon. */
const TYPES: Record<string, string> = { function: "function", data: "class", argument: "property", package: "namespace", variable: "variable" };

async function source(context: CompletionContext): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const word = context.matchBefore(NAME);
  // Typing alone opens suggestions after three characters, as RStudio does.
  // Tab or Control Space asks at any point.
  if (!context.explicit && (!word || word.text.length < 3)) return null;
  // A slow answer, such as while R is busy running code, is dropped rather
  // than left to pop up late.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  const found = await Promise.race([ask(before, before.length).catch(() => null), timeout]);
  if (!found || !found.items.length || context.aborted) return null;
  const options: Completion[] = found.items.map((item, index) => ({
    // R reports an argument as "na.rm=". It is shown and inserted with
    // spaces around the equals sign, as the tidyverse style guide writes it.
    label: item.kind === "argument" ? item.name.replace(/=$/, " =") : item.name,
    apply: item.kind === "argument" ? item.name.replace(/=$/, " = ") : item.name,
    type: TYPES[item.kind] ?? "variable",
    detail: item.kind === "argument" ? "argument" : item.kind === "data" ? "data" : undefined,
    // R lists arguments first inside a call, then everything else.
    boost: -index / 1000,
  }));
  return { from: line.from + found.start, options, validFor: /^[A-Za-z0-9._$@:]*$/ };
}

/** Tab completes when the cursor follows part of a name, and indents
 * otherwise, as in RStudio. With suggestions already showing, Tab takes
 * the highlighted one. Otherwise it asks, which also replaces a quieter
 * request started by typing. */
function tabComplete(view: EditorView) {
  const { state } = view;
  const status = completionStatus(state);
  if (status === "active") return acceptCompletion(view);
  const range = state.selection.main;
  if (!range.empty) return indentMore(view);
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  if (/[A-Za-z0-9._$@:]$/.test(before) || /[(,]\s*$/.test(before)) return startCompletion(view);
  return indentMore(view);
}

/** Completion for an R editor: suggestions from R, opened by typing, Tab,
 * or Control Space. */
export function rCompletion(): Extension {
  return [autocompletion({ override: [source], activateOnTyping: true, activateOnTypingDelay: 250, icons: true }), keymap.of([{ key: "Tab", run: tabComplete }])];
}
