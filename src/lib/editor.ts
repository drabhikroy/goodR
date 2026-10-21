// The code editor: one CodeMirror document per open file, shown in a single
// view, plus the inline output blocks that sit under the lines that made
// them.
//
// Keeping a separate EditorState per file means each tab keeps its own
// undo history, selection, and scroll position when someone switches away
// and back.

import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleLineComment } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { r } from "@codemirror/legacy-modes/mode/r";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Text, type Extension, type TransactionSpec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { rCompletion } from "./completion";
import { maskText } from "./errors";

// The R mode tags a function call as a plain variable. Looking ahead for an
// opening parenthesis lets calls take the function color, which makes
// pipelines easier to scan.
const rMode = {
  ...r,
  token(stream: Parameters<typeof r.token>[0], state: Parameters<typeof r.token>[1]) {
    const style = r.token(stream, state);
    if (style === "variable" && /^\s*\(/.test(stream.string.slice(stream.pos))) return "variableName.function";
    return style;
  },
};

// Code colors come from the active palette's tokens, so they change with
// the color vision setting and pass the same contrast audit.
export const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--string)" },
  { tag: tags.comment, color: "var(--comment)", fontStyle: "italic" },
  { tag: [tags.number, tags.atom, tags.bool], color: "var(--number)" },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName)], color: "var(--function)" },
  { tag: tags.operator, color: "var(--keyword)" },
]);

/** R as CodeMirror understands it, shared by the editor and the console. */
export const rLanguage = () => StreamLanguage.define(rMode);

/** Renders an output block. Set by the interface, which owns React. */
// The editor does not know about React. The app supplies a function that
// draws a card into a container and returns how to remove it.
type BlockRenderer = (container: HTMLElement, blockId: string) => () => void;
let renderBlock: BlockRenderer = () => () => {};
export function setBlockRenderer(renderer: BlockRenderer) {
  renderBlock = renderer;
}

/** The container CodeMirror places under a line for an output card. */
class OutputWidget extends WidgetType {
  private cleanup: (() => void) | null = null;
  constructor(readonly blockId: string) {
    super();
  }
  // Same block, same widget, so CodeMirror keeps the existing DOM rather
  // than rebuilding the card on every keystroke.
  eq(other: OutputWidget) {
    return other.blockId === this.blockId;
  }
  toDOM() {
    const container = document.createElement("div");
    container.className = "cm-output-block";
    container.dataset.block = this.blockId;
    this.cleanup = renderBlock(container, this.blockId);
    return container;
  }
  destroy() {
    this.cleanup?.();
  }
    // Clicks inside a card belong to the card, not the editor.
  ignoreEvent() {
    return true;
  }
}

/** Reports whether a block finished quietly, with no output to show. Set by
 * the app, which owns block state. */
let isQuiet: (blockId: string) => boolean = () => false;
export function setQuietCheck(check: (blockId: string) => boolean) {
  isQuiet = check;
}

/** How a block should be drawn as a cell: its state, and how many lines
 * above its last line belong to it. Null leaves the lines plain. Set by the
 * app, which owns block state. */
type CellInfo = { status: string; span: number } | null;
let cellInfo: (blockId: string) => CellInfo = () => null;
export function setCellInfo(read: (blockId: string) => CellInfo) {
  cellInfo = read;
}

/**
 * Draws each run statement that produced something as the top half of a
 * card, its input. The output widget beneath is the bottom half. Lines
 * keep the same padding inside and outside a card, so code never shifts
 * sideways when it runs.
 */
const cells = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshMarkers) || effect.is(addBlock) || effect.is(removeBlock)));
      if (update.docChanged || refreshed) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const { state } = view;
      const ranges: ReturnType<Decoration["range"]>[] = [];
      state.field(blockField).between(0, state.doc.length, (from, _to, value) => {
        const info = cellInfo((value.spec.widget as OutputWidget).blockId);
        if (!info) return;
        const last = state.doc.lineAt(from).number;
        const first = Math.max(1, last - info.span);
        for (let number = first; number <= last; number += 1) {
          const classes = ["cm-cell", `cm-cell-${info.status}`];
          if (number === first) classes.push("cm-cell-first");
          if (number === last) classes.push("cm-cell-last");
          ranges.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(number).from));
        }
      });
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

class RanMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-ran-marker";
    marker.setAttribute("aria-label", "Ran without output");
    marker.setAttribute("role", "img");
    return marker;
  }
}
const ranMarker = new RanMarker();
const refreshMarkers = StateEffect.define<null>();

// Lines worth pointing at: the statement R is running now, and the
// statement whose result the pointer or focus is on. Each is a range of
// zero based line numbers, or null. They are short lived, so they are not
// moved with edits.
type Marks = { running: [number, number] | null; linked: [number, number] | null };
const setMark = StateEffect.define<{ kind: keyof Marks; range: [number, number] | null }>();
const markField = StateField.define<Marks>({
  create: () => ({ running: null, linked: null }),
  update(marks, transaction) {
    let next = marks;
    for (const effect of transaction.effects) if (effect.is(setMark)) next = { ...next, [effect.value.kind]: effect.value.range };
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field, "doc"], (state) => {
      const marks = state.field(field);
      const ranges: ReturnType<Decoration["range"]>[] = [];
      for (const kind of ["linked", "running"] as const) {
        const range = marks[kind];
        if (!range) continue;
        const last = Math.min(state.doc.lines, range[1] + 1);
        for (let number = Math.max(1, range[0] + 1); number <= last; number += 1) {
          ranges.push(Decoration.line({ class: `cm-line-${kind}` }).range(state.doc.line(number).from));
        }
      }
      return Decoration.set(ranges, true);
    }),
});

// The part of a line R could not run, underlined so it can be found at a
// glance. The underline is wavy as well as colored, so it reads without
// color. A mark follows edits above it, and goes as soon as an edit touches
// it, because the error it pointed at no longer describes the new code.
const setProblems = StateEffect.define<{ from: number; to: number; note: string }[]>();
const problemField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let next = marks;
    for (const effect of transaction.effects) {
      if (effect.is(setProblems)) {
        next = Decoration.set(
          effect.value.map((item) => Decoration.mark({ class: "cm-problem", attributes: { title: item.note } }).range(item.from, item.to)),
          true,
        );
      }
    }
    if (transaction.docChanged && next.size) {
      // Any edit that lands on a marked range removes that mark.
      const touched: [number, number][] = [];
      transaction.changes.iterChangedRanges((fromA, toA) => touched.push([fromA, toA]));
      next = next.update({ filter: (from, to) => !touched.some(([a, b]) => a <= to && b >= from) });
      next = next.map(transaction.changes);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Effects that add or remove a card. Cards are anchored to a position, so
// they move with edits made above them.
const addBlock = StateEffect.define<{ id: string; pos: number }>();
const removeBlock = StateEffect.define<string>();

/** Where each output block sits. Positions move with edits above them. */
const blockField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(removeBlock)) {
        next = next.update({ filter: (_from, _to, value) => (value.spec.widget as OutputWidget).blockId !== effect.value });
      } else if (effect.is(addBlock)) {
        const widget = Decoration.widget({ widget: new OutputWidget(effect.value.id), block: true, side: 1 });
        next = next.update({ add: [widget.range(effect.value.pos)], sort: true });
      }
    }
    return next;
  },
});

// Blocks are always tracked so their line numbers stay right, but they are
// shown only when output is inline.
const inlineDisplay = new Compartment();
let inlineVisible = true;
const showBlocks = () => EditorView.decorations.from(blockField);

/** Editor preferences from Settings. They apply to every open script at
 * once, through one compartment per document. */
export type EditorPrefs = {
  lineNumbers: boolean;
  highlightLine: boolean;
  wrapLines: boolean;
  tabWidth: number;
  closeBrackets: boolean;
  rainbowBrackets: boolean;
  copyResults: boolean;
};
let prefs: EditorPrefs = { lineNumbers: true, highlightLine: true, wrapLines: false, tabWidth: 2, closeBrackets: true, rainbowBrackets: false, copyResults: true };
const prefsSlot = new Compartment();

// Matching brackets share a color by depth, so the pair that closes a long
// call is easy to find. The colors are the code colors of the active
// palette, which already pass the contrast audit on the code background.
const bracketMarks = [0, 1, 2, 3].map((depth) => Decoration.mark({ class: `cm-bracket-${depth}` }));
const rainbow = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      // Depth is counted from the top of the file, with brackets inside
      // text and comments left out, so the colors stay right when scrolled.
      const { from, to } = view.viewport;
      const masked = maskText(view.state.sliceDoc(0, to));
      const ranges: ReturnType<Decoration["range"]>[] = [];
      let depth = 0;
      for (let index = 0; index < masked.length; index += 1) {
        const ch = masked[index];
        if (ch === "(" || ch === "[" || ch === "{") {
          if (index >= from) ranges.push(bracketMarks[depth % 4].range(index, index + 1));
          depth += 1;
        } else if (ch === ")" || ch === "]" || ch === "}") {
          depth = Math.max(0, depth - 1);
          if (index >= from) ranges.push(bracketMarks[depth % 4].range(index, index + 1));
        }
      }
      return Decoration.set(ranges);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function prefExtensions(): Extension[] {
  return [
    prefs.lineNumbers ? lineNumbers() : [],
    prefs.highlightLine ? [highlightActiveLineGutter(), highlightActiveLine()] : [],
    prefs.wrapLines ? EditorView.lineWrapping : [],
    EditorState.tabSize.of(prefs.tabWidth),
    indentUnit.of(" ".repeat(prefs.tabWidth)),
    prefs.closeBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    prefs.rainbowBrackets ? rainbow : [],
  ];
}

/** Applies new editor preferences to every open script. */
export function setPreferences(next: Partial<EditorPrefs>) {
  prefs = { ...prefs, ...next };
  const effects = prefsSlot.reconfigure(prefExtensions());
  for (const [path, state] of states) {
    if (path !== shown) states.set(path, state.update({ effects }).state);
  }
  view?.dispatch({ effects });
}

/** The text of a result as it would read in a console, for copying a
 * selection that crosses results. Set by the app, which owns results. */
let resultText: (blockId: string) => string | null = () => null;
export function setResultText(read: (blockId: string) => string | null) {
  resultText = read;
}

/**
 * Copying a selection that runs across results takes the results too, in
 * the order they appear, so what is pasted matches what was selected on
 * screen. CodeMirror on its own copies only the code, and a drag across
 * several results then seemed to copy only part of them. Settings can turn
 * this off for people who want code alone.
 */
const copyWithResults = EditorView.domEventHandlers({
  copy(event, view) {
    if (!prefs.copyResults || !event.clipboardData) return false;
    const range = view.state.selection.main;
    if (range.empty) return false;
    const inside: { pos: number; id: string }[] = [];
    view.state.field(blockField).between(range.from, range.to, (from, _to, value) => {
      if (from >= range.from && from < range.to) inside.push({ pos: from, id: (value.spec.widget as OutputWidget).blockId });
    });
    if (!inside.length) return false;
    inside.sort((a, b) => a.pos - b.pos);
    let text = "";
    let pos = range.from;
    for (const block of inside) {
      text += view.state.sliceDoc(pos, block.pos);
      const result = resultText(block.id);
      if (result) text += `\n${result}`;
      pos = block.pos;
    }
    text += view.state.sliceDoc(pos, range.to);
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    return true;
  },
});

/**
 * The width of the code area a reader can see, kept in a CSS variable.
 * Results are capped to it, so their text wraps inside the window even
 * when a long line of code makes the editor scroll sideways.
 */
const visibleWidth = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.geometryChanged) this.measure();
    }
    measure() {
      this.view.requestMeasure({
        read: (view) => {
          const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters");
          return view.scrollDOM.clientWidth - (gutters?.offsetWidth ?? 0);
        },
        write: (width, view) => {
          if (width > 0) view.dom.style.setProperty("--result-width", `${width}px`);
        },
      });
    }
  },
);

/** Callbacks the editor needs from the rest of the app. */
// What the editor tells the app: edits, cursor moves, and run shortcuts.
type Hooks = { onChange: (path: string) => void; onCursor: (path: string) => void; runLine: () => void; runFile: () => void; bindRunKeys: boolean };
let hooks: Hooks = { onChange: () => {}, onCursor: () => {}, runLine: () => {}, runFile: () => {}, bindRunKeys: true };
export function setEditorHooks(next: Hooks) {
  hooks = next;
}

// One saved state per open file, plus its text as last saved, which is how
// the edited mark is worked out.
const states = new Map<string, EditorState>();
const saved = new Map<string, Text>();
let view: EditorView | null = null;
let shown: string | null = null;

/** Everything a document needs: line numbers, history, search, brackets,
 * the R language, colors, output cards, and keys. */
function extensions(path: string): Extension[] {
  const isR = /\.(R|r|Rprofile|qmd|Rmd|rmd)$/.test(path) || path.startsWith("untitled:");
  // In the desktop app the menu bar owns Command Return, so binding it here
  // too would run the line twice on some systems.
  const runKeys = hooks.bindRunKeys
    ? [
        { key: "Mod-Enter", run: () => (hooks.runLine(), true) },
        { key: "Shift-Mod-Enter", run: () => (hooks.runFile(), true) },
      ]
    : [];
  return [
    prefsSlot.of(prefExtensions()),
    history(),
    // The browser paints the selection itself. CodeMirror's own selection
    // layer sits behind the text, so any line with its own background, such
    // as the active line or a result's code band, covered it and nothing
    // looked selected. The browser's selection paints above every background.
    indentOnInput(),
    bracketMatching(),
    // Suggestions come from R. Its Tab binding sits ahead of the keymap
    // below, so Tab completes after a name and indents elsewhere.
    rCompletion(),
    highlightSelectionMatches(),
    search({ top: true }),
    isR ? StreamLanguage.define(rMode) : [],
    syntaxHighlighting(highlight),
    copyWithResults,
    visibleWidth,
    blockField,
    markField,
    problemField,
    cells,
    // Statements that ran without printing anything get a check in this
    // gutter instead of an empty card, as in the design.
    gutter({
      class: "cm-ran-gutter",
      lineMarker(gutterView, line) {
        let quiet = false;
        gutterView.state.field(blockField).between(line.to, line.to, (_from, _to, value) => {
          if (isQuiet((value.spec.widget as OutputWidget).blockId)) quiet = true;
        });
        return quiet ? ranMarker : null;
      },
      lineMarkerChange: (update) => update.docChanged || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshMarkers) || effect.is(addBlock) || effect.is(removeBlock))),
    }),
    inlineDisplay.of(inlineVisible ? showBlocks() : []),
    // Shift Command K renders a report, from the menu bar or the window's
    // own shortcut handler. CodeMirror's default binds it to deleting the
    // line, so that one binding is left out and the key passes through.
    keymap.of([...runKeys, ...defaultKeymap.filter((binding) => binding.key !== "Shift-Mod-k"), ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) hooks.onChange(path);
      if (update.selectionSet || update.docChanged) hooks.onCursor(path);
    }),
    // The text area is already in the Tab order, being editable. Saying so
    // with tabindex lets checkers such as axe see that the scrolling editor
    // can be reached from the keyboard.
    EditorView.contentAttributes.of({ "aria-label": `Code editor, ${path.split("/").pop()}`, tabindex: "0" }),
  ];
}

/** Replaces a document's text as an edit, so it shows as changed against
 * the saved file and can be undone. Used to bring back unsaved work after
 * the window reloads. */
export function replaceText(path: string, text: string) {
  const state = stateOf(path);
  if (!state || state.doc.toString() === text) return;
  apply(path, { changes: { from: 0, to: state.doc.length, insert: text } });
}

/** Creates the single editor view inside the page. */
export function mountEditor(parent: HTMLElement) {
  view = new EditorView({ parent, state: EditorState.create({ doc: "" }) });
  if (shown && states.has(shown)) view.setState(states.get(shown)!);
  return () => {
    if (view && shown) states.set(shown, view.state);
    view?.destroy();
    view = null;
  };
}

/** Starts a document for a file, remembering its text as saved. */
export function openDocument(path: string, text: string) {
  if (states.has(path)) return;
  const state = EditorState.create({ doc: text, extensions: extensions(path) });
  states.set(path, state);
  saved.set(path, state.doc);
}

/** Forgets a document when its tab closes. */
export function closeDocument(path: string) {
  states.delete(path);
  saved.delete(path);
  if (shown === path) shown = null;
}

/** Moves a document to a new path, used when an untitled file is saved. */
export function renameDocument(from: string, to: string) {
  const state = from === shown && view ? view.state : states.get(from);
  if (!state) return;
  states.delete(from);
  // Rebuilt so the language and labels match the new file name, keeping
  // the text and the cursor.
  const next = EditorState.create({ doc: state.doc, selection: state.selection, extensions: extensions(to) });
  states.set(to, next);
  saved.set(to, next.doc);
  saved.delete(from);
  if (shown === from) {
    shown = to;
    view?.setState(next);
  }
}

/** Swaps the visible document, keeping the one leaving with its undo
 * history and selection intact. */
export function showDocument(path: string | null) {
  if (shown && view && states.has(shown)) states.set(shown, view.state);
  shown = path;
  if (!view) return;
  const state = path ? states.get(path) : undefined;
  view.setState(state ?? EditorState.create({ doc: "" }));
  if (state) {
    syncInline(view.state);
    view.focus();
  }
}

/** A document's current state, whether it is visible or not. */
function stateOf(path: string): EditorState | undefined {
  return path === shown && view ? view.state : states.get(path);
}

/** Applies a change to a document, through the view when it is visible. */
function apply(path: string, spec: TransactionSpec) {
  if (path === shown && view) view.dispatch(spec);
  else {
    const state = states.get(path);
    if (state) states.set(path, state.update(spec).state);
  }
}

/** The full text of a document. */
export function getText(path: string): string {
  return stateOf(path)?.doc.toString() ?? "";
}

/** Whether a document differs from what was last saved. */
export function isDirty(path: string): boolean {
  const state = stateOf(path);
  const baseline = saved.get(path);
  return Boolean(state && baseline && !state.doc.eq(baseline));
}

/** Records the current text as saved. */
export function markSaved(path: string) {
  const state = stateOf(path);
  if (state) saved.set(path, state.doc);
}

/** The cursor line (zero based) and any selected text. */
export function cursor(path: string): { line: number; column: number; selection: string; selectionEndLine: number; lineCount: number } {
  const state = stateOf(path);
  if (!state) return { line: 0, column: 0, selection: "", selectionEndLine: 0, lineCount: 0 };
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  return {
    line: line.number - 1,
    column: range.head - line.from,
    selection: state.sliceDoc(range.from, range.to),
    selectionEndLine: state.doc.lineAt(range.to).number - 1,
    lineCount: state.doc.lines,
  };
}

/** Puts the cursor at the start of a line and scrolls it into view. */
export function goToLine(path: string, line: number) {
  const state = stateOf(path);
  if (!state) return;
  const target = state.doc.line(Math.min(state.doc.lines, Math.max(1, line + 1)));
  apply(path, { selection: EditorSelection.cursor(target.from), scrollIntoView: true });
  if (path === shown) view?.focus();
}

/** Places a card under a line. */
export function attachBlock(path: string, id: string, line: number) {
  const state = stateOf(path);
  if (!state) return;
  const pos = state.doc.line(Math.min(state.doc.lines, line + 1)).to;
  apply(path, { effects: addBlock.of({ id, pos }) });
}

/** Marks lines as running, or as the source of the result being looked
 * at. A null range clears the mark. */
export function markLines(path: string, kind: keyof Marks, range: [number, number] | null) {
  if (stateOf(path)) apply(path, { effects: setMark.of({ kind, range }) });
}

/**
 * Underlines the part of a line that R could not run, and returns whether
 * it was found. `text` is the code to mark and `near` the column it was
 * expected at, so a repeated word marks the one nearest the expected spot.
 * Nothing is marked when the line no longer holds that text, since the
 * file may have changed since the statement ran.
 */
export function markProblem(path: string, line: number, text: string, near: number, note: string): boolean {
  const state = stateOf(path);
  if (!state || !text || line < 0 || line >= state.doc.lines) return false;
  const row = state.doc.line(line + 1);
  let best = -1;
  for (let at = row.text.indexOf(text); at >= 0; at = row.text.indexOf(text, at + 1)) {
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  if (best < 0) return false;
  apply(path, { effects: setProblems.of([{ from: row.from + best, to: row.from + best + text.length, note }]) });
  return true;
}

/** Removes every underline in a file, as when a statement runs again. */
export function clearProblems(path: string) {
  const state = stateOf(path);
  if (state && state.field(problemField).size) apply(path, { effects: setProblems.of([]) });
}

/** Selects part of a line and scrolls it into view, for Go to the spot. */
export function selectSpan(path: string, line: number, text: string, near: number) {
  const state = stateOf(path);
  if (!state || line < 0 || line >= state.doc.lines) return;
  const row = state.doc.line(line + 1);
  let best = -1;
  for (let at = row.text.indexOf(text); text && at >= 0; at = row.text.indexOf(text, at + 1)) {
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  const from = best >= 0 ? row.from + best : row.from;
  const to = best >= 0 ? from + text.length : row.to;
  apply(path, { selection: EditorSelection.range(from, to), scrollIntoView: true });
  if (path === shown) view?.focus();
}

/** Removes a card from a document. */
export function detachBlock(path: string, id: string) {
  apply(path, { effects: removeBlock.of(id) });
}

/** Current zero based line of each block in a file, after any edits. */
export function blockLines(path: string): Map<string, number> {
  const lines = new Map<string, number>();
  const state = stateOf(path);
  if (!state) return lines;
  state.field(blockField).between(0, state.doc.length, (from, _to, value) => {
    lines.set((value.spec.widget as OutputWidget).blockId, state.doc.lineAt(from).number - 1);
  });
  return lines;
}

/** Replaces every whole word `from` with `to` inside a range of lines. */
export function replaceWord(path: string, fromLine: number, toLine: number, from: string, to: string) {
  const state = stateOf(path);
  if (!state) return;
  const start = state.doc.line(fromLine + 1).from;
  const end = state.doc.line(Math.min(state.doc.lines, toLine + 1)).to;
  const text = state.sliceDoc(start, end);
  const pattern = new RegExp(`(?<![\\w.])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.])`, "g");
  const changes = [...text.matchAll(pattern)].map((match) => ({ from: start + (match.index ?? 0), to: start + (match.index ?? 0) + from.length, insert: to }));
  if (changes.length) apply(path, { changes });
}

/** Replaces whole lines with new text, as one step that Undo reverses. */
export function replaceLines(path: string, fromLine: number, toLine: number, text: string) {
  const state = stateOf(path);
  if (!state) return;
  const start = state.doc.line(Math.min(state.doc.lines, fromLine + 1)).from;
  const end = state.doc.line(Math.min(state.doc.lines, toLine + 1)).to;
  apply(path, { changes: { from: start, to: end, insert: text }, selection: EditorSelection.cursor(start + text.length), scrollIntoView: true, userEvent: "input.paste" });
}

/** Shows or hides inline cards when the output layout changes. */
export function setInlineVisible(visible: boolean) {
  inlineVisible = visible;
  if (view) syncInline(view.state);
}

/** Applies the inline setting to the visible document. */
function syncInline(_state: EditorState) {
  view?.dispatch({ effects: inlineDisplay.reconfigure(inlineVisible ? showBlocks() : []) });
}

/** Scrolls an output card into view if any of it is hidden. */
export function revealBlock(blockId: string) {
  const element = view?.dom.querySelector<HTMLElement>(`.cm-output-block[data-block="${blockId}"]`);
  if (!element || !view) return;
  // Only the vertical position changes. A result is as wide as the longest
  // line, so letting the browser scroll sideways too would hide the start
  // of every line under the line numbers.
  const left = view.scrollDOM.scrollLeft;
  element.scrollIntoView({ block: "nearest" });
  view.scrollDOM.scrollLeft = left;
}

/** Redraws the gutter checks after a block finishes. */
export function refreshGutter() {
  view?.dispatch({ effects: refreshMarkers.of(null) });
}

/** Moves keyboard focus into the editor. */
export function focusEditor() {
  view?.focus();
}

/** Asks CodeMirror to measure again after card or layout changes. */
export function requestMeasure() {
  view?.requestMeasure();
}

/** Comments or uncomments the selected lines with #. */
export function commentLines() {
  if (view) toggleLineComment(view);
}

/** Opens find and replace at the top of the editor. */
export function openFind() {
  if (view) openSearchPanel(view);
}

/** Types text at the cursor of the script on show, replacing any
 * selection, as if the person had typed it. Returns false with no script. */
export function insertAtCursor(text: string, select?: [number, number]) {
  if (!view) return false;
  const range = view.state.selection.main;
  const anchor = range.from + (select ? select[0] : text.length);
  const head = range.from + (select ? select[1] : text.length);
  view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: EditorSelection.single(anchor, head), scrollIntoView: true, userEvent: "input.type" });
  view.focus();
  return true;
}

// The console's typing box is its own small editor. It registers here, so
// commands such as Insert Pipe act on whichever editor has focus.
let consoleView: EditorView | null = null;
export function registerConsoleView(next: EditorView | null) {
  consoleView = next;
}

/** The editor the person is typing in: the console's when it has focus,
 * otherwise the script's. */
function focusedView() {
  return consoleView?.hasFocus ? consoleView : view;
}

/** Types text at the cursor of whichever editor has focus. */
export function insertWhereFocused(text: string) {
  const target = focusedView();
  if (!target) return;
  const range = target.state.selection.main;
  target.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: EditorSelection.cursor(range.from + text.length), scrollIntoView: true, userEvent: "input.type" });
  target.focus();
}

/** True when the script's cursor line holds nothing but spaces. */
export function cursorLineIsBlank() {
  if (!view) return true;
  return !view.state.doc.lineAt(view.state.selection.main.head).text.trim();
}

/** The name at the cursor in whichever editor has focus, for help. */
export function wordAtCursor(): string {
  const view = focusedView();
  if (!view) return "";
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return state.sliceDoc(range.from, range.to).trim();
  const line = state.doc.lineAt(range.head);
  const offset = range.head - line.from;
  const before = /[A-Za-z0-9._]*$/.exec(line.text.slice(0, offset))?.[0] ?? "";
  const after = /^[A-Za-z0-9._]*/.exec(line.text.slice(offset))?.[0] ?? "";
  return before + after;
}

export function insertText(path: string, text: string) {
  const state = stateOf(path);
  if (!state) return;
  apply(path, { changes: { from: state.doc.length, insert: text } });
}
