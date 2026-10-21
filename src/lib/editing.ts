// Tools for changing code that reach past one line: hints about habits
// that cause trouble later, explaining a line without the assistant,
// tidying code with styler, renaming an object everywhere in a script, and
// finding text in every script of a project.
//
// Each one works on the script in front and changes it as one edit, so one
// Undo takes it back. The reading of code lives in hints.ts, explain.ts,
// and rename.ts, which have no part in the interface and are tested alone.
// This file joins them to the editor, to R, and to the dialogs.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { assistOnCode, codeAtCursor } from "./assistant";
import { installPackages, notify, openDialog, openFile, requireR, sessionOfFile } from "./app";
import { chunkAt, chunksOf, codeOnly, isDocument } from "./chunks";
import { lineSteps } from "./explain";
import { findHints } from "./hints";
import { isPlainName, renamePlaces, type Place } from "./rename";
import { getState, sessionOf } from "./store";

let api: Backend;

export function initEditing(backend: Backend) {
  api = backend;
}

/** The code of a file as the tools read it: a document's prose blanked,
 * with every line keeping its number. */
function codeOf(path: string) {
  const text = editor.getText(path);
  return isDocument(path) ? codeOnly(text) : text;
}

// Hints.

/** Marks the hints in a file, or clears them when hints are turned off. */
export function updateHints(path: string) {
  if (path.startsWith("data:")) return;
  const isR = /\.(R|r|qmd|Rmd|rmd)$/.test(path) || path.startsWith("untitled:");
  if (!getState().settings.hints || !isR) {
    editor.setHints(path, []);
    return;
  }
  const inProject = sessionOfFile(path).startsWith("project:");
  editor.setHints(path, findHints(codeOf(path), inProject));
}

/** Marks or clears the hints in every open file, after the setting changes. */
export function refreshAllHints() {
  for (const tab of getState().tabs) if (tab.kind !== "data") updateHints(tab.path);
}

// Explain this code.

/**
 * Says what the code at the cursor does, step by step, in a note above
 * it: each function in the order R finishes it, with the title of its help
 * page when R is free to read it, then where the result is stored. The
 * assistant, when it is set up, can say more from a button in the note.
 */
export async function explainAtCursor() {
  const target = codeAtCursor();
  if (!target) return notify("Put the cursor on some code, or select it, first.");
  const steps = lineSteps(target.code);
  const session = sessionOfFile(target.file);
  const ready = sessionOf(session).r.status === "ready";
  const titles = new Map<string, string>();
  if (ready) {
    for (const name of steps.calls.slice(0, 8)) {
      const brief = await api.brief(session, name).catch(() => null);
      if (brief?.found && brief.title) titles.set(name, brief.title);
    }
  }
  const items: string[] = steps.calls.map((name) => (titles.has(name) ? `${name}(): ${titles.get(name)}` : `${name}()`));
  if (steps.assigns) items.push(`The result is stored as ${steps.assigns}, so later lines can use it.`);
  // The note goes beside the code it explains, so it is not shown when
  // another file came to the front while R read the help titles.
  if (getState().active !== target.file) return;
  const assistantReady = Boolean(getState().assistant.model);
  editor.showNote(target.from, () => explanationDom(items, steps.pipes, ready, assistantReady));
}

/** The explanation as the note shows it. */
function explanationDom(items: string[], pipes: boolean, ready: boolean, assistantReady: boolean) {
  const dom = document.createElement("div");
  dom.className = "quick-help explain-note";
  dom.setAttribute("role", "status");
  const heading = document.createElement("p");
  heading.className = "quick-help-heading";
  heading.textContent = "What this code does, in order";
  dom.append(heading);
  if (!items.length) {
    const only = document.createElement("p");
    only.textContent = "It shows a value. Nothing is called and nothing is stored.";
    dom.append(only);
  } else {
    const list = document.createElement("ol");
    for (const text of items) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
    dom.append(list);
  }
  if (pipes) {
    const pipe = document.createElement("p");
    pipe.className = "muted";
    pipe.textContent = "A pipe, |> or %>%, hands what is on its left to the call on its right as the first input.";
    dom.append(pipe);
  }
  if (!ready) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Once R is free, this also says what each function is for.";
    dom.append(note);
  }
  const row = document.createElement("div");
  row.className = "button-row";
  if (assistantReady) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "button small";
    more.textContent = "Ask the assistant for more";
    more.addEventListener("click", () => {
      editor.closeNote();
      assistOnCode("explainCode");
    });
    row.append(more);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "button small quiet";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    editor.closeNote();
    editor.focusEditor();
  });
  row.append(close);
  dom.append(row);
  return dom;
}

// Tidy code.

/** The text Tidy code works on: the selected lines, the chunk at the
 * cursor in a document, or the whole script. Offsets are into the file. */
function tidyTarget(path: string): { from: number; to: number; code: string; what: string } | null {
  const text = editor.getText(path);
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const span = (fromLine: number, toLine: number, what: string) => {
    const from = starts[fromLine];
    const to = starts[toLine] + lines[toLine].length;
    return { from, to, code: text.slice(from, to), what };
  };
  const lineAt = (at: number) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= at) line += 1;
    return line;
  };
  // A selection is widened to whole lines, so a line is never cut in two.
  // A selection of everything is the script, said as such.
  const selection = editor.selectionOffsets();
  if (selection && (selection.from > 0 || selection.to < text.length)) return span(lineAt(selection.from), lineAt(Math.max(selection.from, selection.to - 1)), "the selected lines");
  if (isDocument(path)) {
    const chunk = chunkAt(chunksOf(text), editor.cursor(path).line);
    if (!chunk || chunk.engine !== "r" || chunk.to < chunk.from) return null;
    return span(chunk.from, chunk.to, "this chunk");
  }
  return { from: 0, to: text.length, code: text, what: "the script" };
}

/**
 * Tidies the code with styler, the tidyverse style tool: spaces around
 * operators, consistent indenting, one style of quotes. The meaning never
 * changes, and code that does not parse is left as it is. When styler is
 * missing, it asks before installing it.
 */
export async function tidyCode() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  const target = tidyTarget(active);
  if (!target) return notify("Put the cursor in an R chunk, or select some code, to tidy it.");
  if (!target.code.trim()) return notify("There is no code here to tidy.");
  const session = sessionOfFile(active);
  if (!requireR(session)) return;
  if (sessionOf(session).r.status !== "ready") return notify("R is busy. Tidy code works once this run finishes.");
  const result = await api.style(session, target.code).catch((error) => ({ missing: false, error: String(error), text: undefined }));
  if (result.missing) {
    const sure = await api.confirm("Tidy code uses styler, an R package that is not installed yet. Install it now? It takes a minute.", "Install styler");
    if (sure) {
      installPackages(["styler"]);
      notify("Once styler is installed, choose Tidy code again.");
    }
    return;
  }
  if (result.error || result.text === undefined) {
    return notify(`R could not read this code, so it was left as it is. ${result.error ?? ""}`.trim(), "error");
  }
  // styler drops a final newline the code may have had, so it is kept.
  const text = target.code.endsWith("\n") && !result.text.endsWith("\n") ? `${result.text}\n` : result.text;
  if (text === target.code) return notify(`${target.what.charAt(0).toUpperCase()}${target.what.slice(1)} is already tidy.`);
  // The file may have changed while styler ran. Then nothing is replaced.
  if (editor.getText(active).slice(target.from, target.to) !== target.code) return notify("The code changed while it was being tidied. Try again.");
  editor.replaceSpan(active, target.from, target.to, text);
  notify(`Tidied ${target.what}. Undo puts it back.`);
}

// Rename everywhere.

/** What the Rename dialog works on: the file and the name it opened with. */
export type RenameTarget = { path: string; name: string };
let renameTarget: RenameTarget | null = null;

export function currentRenameTarget() {
  return renameTarget;
}

/** Opens Rename for the name at the cursor. */
export function openRename() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  const name = editor.wordAtCursor();
  if (!name || !isPlainName(name)) return notify("Put the cursor on the name of an object, such as a variable or a function you made, to rename it.");
  if (!renamePlaces(codeOf(active), name).length) return notify(`${name} is not used as an object in this file.`);
  renameTarget = { path: active, name };
  openDialog("rename");
}

/** Every place a name stands for the object, with each line's text, for
 * the dialog's preview. */
export function renamePreview(target: RenameTarget): { places: Place[]; lines: { line: number; text: string }[]; taken: (name: string) => boolean } {
  const code = codeOf(target.path);
  const places = renamePlaces(code, target.name);
  const all = code.split("\n");
  const lines = [...new Set(places.map((place) => place.line))].map((line) => ({ line, text: all[line] }));
  return { places, lines, taken: (name: string) => renamePlaces(code, name).length > 0 };
}

/** Renames the object, as one edit. */
export function applyRename(target: RenameTarget, to: string) {
  const places = renamePlaces(codeOf(target.path), target.name);
  editor.replacePlaces(target.path, places, to);
  openDialog(null);
  notify(`Renamed ${target.name} to ${to} in ${places.length} ${places.length === 1 ? "place" : "places"}. Run the script again so R knows the new name.`);
}

// Find in all files.

/** One line that matches, with where the match starts. */
export type FileMatch = { line: number; col: number; text: string; match: string };
export type FileMatches = { path: string; name: string; matches: FileMatch[] };

/** The scripts Find in all files looks through: the open ones, then the
 * rest of the project, each once. */
export function searchableFiles(): string[] {
  const { tabs, activeSession } = getState();
  const open = tabs.filter((tab) => tab.kind !== "data").map((tab) => tab.path);
  const project = sessionOf(activeSession).project;
  const inProject = project ? project.scripts.map((script) => `${project.root}/${script}`) : [];
  return [...new Set([...open, ...inProject])];
}

/** Reads a file for searching: the editor's text when it is open, since
 * it may have changes not saved yet, or else the file on disk. */
async function textFor(path: string): Promise<string | null> {
  if (getState().tabs.some((tab) => tab.path === path)) return editor.getText(path);
  return api.readText(path).catch(() => null);
}

/** Escapes text for use inside a regular expression. */
function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every line in the searchable files that holds the query. At most 500
 * matches are listed, so a common word stays quick. */
export async function findInFiles(query: string, matchCase: boolean, wholeWord: boolean): Promise<{ files: FileMatches[]; more: boolean }> {
  if (!query) return { files: [], more: false };
  const pattern = new RegExp(wholeWord ? `(?<![A-Za-z0-9._])${escape(query)}(?![A-Za-z0-9._])` : escape(query), matchCase ? "g" : "gi");
  const files: FileMatches[] = [];
  let count = 0;
  for (const path of searchableFiles()) {
    const text = await textFor(path);
    if (text === null) continue;
    const matches: FileMatch[] = [];
    text.split("\n").forEach((line, index) => {
      pattern.lastIndex = 0;
      const found = pattern.exec(line);
      if (found && count < 500) {
        matches.push({ line: index, col: found.index, text: line, match: found[0] });
        count += 1;
      }
    });
    if (matches.length) files.push({ path, name: path.split(/[\\/]/).pop() ?? path, matches });
  }
  return { files, more: count >= 500 };
}

/** Opens a file at a match, with the match selected. */
export async function openMatch(path: string, match: FileMatch) {
  openDialog(null);
  await openFile(path);
  editor.selectSpan(path, match.line, match.match, match.col);
}
