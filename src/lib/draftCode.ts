// Write code for this comment: sends the comment at the cursor to the
// assistant and streams its answer into a draft under the line. R's parser
// checks the draft, and nothing is inserted until Insert is pressed. On a
// line that is not a comment, it asks what the code should do instead.

import * as editor from "./editor";
import { askForCode, checkCode, stopAnswer } from "./assistant";
import { notify } from "./app";
import { getState } from "./store";

/** The R in an answer: its first fenced block, or the whole answer when
 * it has none. */
export function codeFromAnswer(answer: string): string {
  const fenced = /```[ \t]*(?:\{?r\}?)?[^\n]*\n([\s\S]*?)```/i.exec(answer);
  return (fenced ? fenced[1] : answer).replace(/^\n+|\s+$/g, "");
}

/** The description in a comment line, such as "# mean mass by species",
 * or null when the line is not a comment. */
export function commentRequest(line: string): string | null {
  const found = /^\s*#+'?\s*(.*\S)\s*$/.exec(line);
  return found && !/^-+$/.test(found[1]) ? found[1] : null;
}

/** A button for the draft, styled as the app's own. The draft is built
 * outside React, since it lives in an editor widget. */
function button(label: string, primary: boolean, onClick: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `button small${primary ? " primary" : " quiet"}`;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

/** Puts the code under a line, at the line's indentation, as one edit. */
function insertBelow(path: string, line: number, code: string) {
  const text = editor.getText(path);
  const lines = text.split("\n");
  const indent = /^\s*/.exec(lines[line] ?? "")![0];
  // The end of the line, as an offset into the whole text.
  const at = lines.slice(0, line + 1).reduce((sum, item) => sum + item.length + 1, 0) - 1;
  const body = code
    .split("\n")
    .map((row) => (row ? indent + row : row))
    .join("\n");
  editor.replaceSpan(path, at, at, `\n${body}`);
  editor.goToLine(path, line + code.split("\n").length);
}

/** Asks for code for a description and shows it in a draft under `line`. */
function draft(path: string, line: number, request: string) {
  // The answer so far, and the parts of the draft it fills as it arrives.
  let answer = "";
  let pre: HTMLPreElement | null = null;
  let status: HTMLParagraphElement | null = null;
  let actions: HTMLDivElement | null = null;
  editor.showNote(
    line,
    () => {
      const dom = document.createElement("div");
      dom.className = "quick-help code-draft";
      dom.setAttribute("role", "status");
      const heading = document.createElement("p");
      heading.className = "quick-help-heading";
      heading.textContent = `Code for: ${request}`;
      pre = document.createElement("pre");
      status = document.createElement("p");
      status.className = "muted";
      status.textContent = "Writing";
      actions = document.createElement("div");
      actions.className = "button-row";
      actions.append(button("Stop", false, () => (stopAnswer(), editor.closeNote())));
      dom.append(heading, pre, status, actions);
      return dom;
    },
    true,
  );
  askForCode(
    request,
    (text) => {
      answer += text;
      if (pre) pre.textContent = codeFromAnswer(answer);
    },
    async (error) => {
      if (!status || !actions) return;
      // Writing is over: Stop gives way to what can be done with the code.
      actions.replaceChildren();
      const code = codeFromAnswer(answer);
      if (error || !code) {
        status.textContent = error || "The assistant did not write any code. Try describing it another way.";
        actions.append(button("Close", false, () => editor.closeNote()));
        return;
      }
      // R's parser reads it without running it, so a broken draft is
      // flagged before anyone relies on it.
      const parsed = await checkCode(code);
      status.textContent =
        parsed === "invalid"
          ? "R cannot read this as it is. Insert it to fix it by hand, or ask again in other words."
          : parsed === "incomplete"
            ? "This looks unfinished. Check it before running it."
            : "R can read this. Check it does what you meant before running it.";
      actions.append(
        button("Insert", true, () => {
          editor.closeNote();
          insertBelow(path, line, code);
        }),
        button("Try again", false, () => draft(path, line, request)),
        button("Discard", false, () => editor.closeNote()),
      );
    },
  ).then((started) => {
    // Not started means setup opened instead, since no model is chosen.
    if (!started) editor.closeNote();
  });
}

/** Writes code for the comment at the cursor, or asks what to write. */
export function writeCodeHere() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return notify("Open a script, and write what you want as a comment, such as # mean magnitude for each kind of star.");
  const line = editor.cursor(active).line;
  const text = editor.getText(active).split("\n")[line] ?? "";
  const request = commentRequest(text);
  if (request) return draft(active, line, request);
  // Not a comment: a small box asks what the code should do.
  editor.showNote(
    line,
    () => {
      const dom = document.createElement("form");
      dom.className = "quick-help code-draft";
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = "What should the code do?";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Mean magnitude for each kind of star, as a bar chart";
      label.append(input);
      const actions = document.createElement("div");
      actions.className = "button-row";
      const write = button("Write it", true, () => {});
      write.type = "submit";
      actions.append(write, button("Cancel", false, () => editor.closeNote()));
      dom.append(label, actions);
      dom.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input.value.trim()) draft(active, line, input.value.trim());
      });
      setTimeout(() => input.focus(), 0);
      return dom;
    },
    true,
  );
}
