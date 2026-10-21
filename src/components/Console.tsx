// The console: a place to type R directly, with the record of what was
// typed there above it. It is a drawer under the editor. Its top edge
// resizes the whole drawer, and the edge above the typing box resizes the
// box itself, so a long statement has room. Both move with the arrow keys
// once focused, and both sizes are remembered.
//
// The typing box is a small code editor, so typed R is colored as in the
// script, brackets match, and Tab completes names, as in RStudio's console.
// Return runs the input when it is a whole statement. When it is not, the
// line continues, as R itself shows with a plus sign. Shift Return adds a
// line without running.

import { closeBrackets, closeBracketsKeymap, completionStatus } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clearConsole, runConsole, shortPath, togglePane, updateSettings } from "../lib/app";
import { keyLabel } from "../lib/commands";
import { rCompletion } from "../lib/completion";
import { highlight, registerConsoleView, rLanguage } from "../lib/editor";
import { getState, useStore } from "../lib/store";
import { ChevronIcon } from "./Icons";
import { Splitter } from "./Splitter";

const MIN_HEIGHT = 160;
const MIN_INPUT = 56;

export function Console() {
  const entries = useStore((state) => state.console);
  const pending = useStore((state) => state.pendingInput);
  const open = useStore((state) => state.ui.consoleOpen);
  const height = useStore((state) => state.settings.consoleHeight);
  const inputHeight = useStore((state) => state.settings.consoleInputHeight);
  const workingDir = useStore((state) => state.r.workingDir);
  const log = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  // Follows new output only while the reader is already at the bottom, so
  // scrolling up to read earlier output is never yanked away.
  useLayoutEffect(() => {
    if (stuck.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries, open]);

  const maxHeight = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.75));
  // The typing box can take most of the drawer, leaving room for the head
  // and a few lines of the record above it.
  const maxInput = open ? Math.max(MIN_INPUT, height - 110) : 360;
  const shownInput = Math.min(inputHeight, maxInput);

  return (
    <>
      {/* The edge sits in the gap between the script and the console, so
          the gap itself is what is dragged. */}
      {open && (
        <Splitter
          className="console-edge"
          label="Console height"
          axis="row"
          value={height}
          min={MIN_HEIGHT}
          max={maxHeight}
          onChange={(value) => updateSettings({ consoleHeight: value })}
        />
      )}
    <section className={`console ${open ? "is-open" : ""}`} aria-label="Console" style={open ? { height } : undefined}>
      {open && (
        <header className="console-head">
          <button type="button" className="console-toggle" aria-expanded="true" aria-controls="console-log" onClick={() => togglePane("consoleOpen")}>
            <ChevronIcon size={12} open />
            Console
          </button>
          {workingDir && <span className="muted truncate console-folder">in {shortPath(workingDir)}</span>}
          {entries.length > 0 && (
            <button type="button" className="button quiet" onClick={clearConsole}>
              Clear
            </button>
          )}
        </header>
      )}
      <div
        id="console-log"
        hidden={!open}
        className="console-log"
        ref={log}
        role="log"
        aria-live="off"
        // Focusable so keyboard users can scroll back through output.
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        {entries.map((entry) => (
          <div key={entry.id} className={`console-entry kind-${entry.kind} ${entry.name === "stderr" ? "is-stderr" : ""}`}>
            {entry.kind === "input" ? (
              entry.text.split("\n").map((line, index) => (
                <div key={index}>
                  <span className="prompt" aria-hidden="true">
                    {index === 0 ? ">" : "+"}
                  </span>
                  {line}
                </div>
              ))
            ) : entry.kind === "error" ? (
              // The headline of a plain error stands out, and the explanation
              // below it reads as ordinary text, which is easier to take in
              // than a whole block in the error color.
              <>
                <pre className="console-error-title">{entry.text.split("\n")[0]}</pre>
                <pre className="console-error-body">{entry.text.split("\n").slice(1).join("\n").replace(/\n$/, "")}</pre>
              </>
            ) : (
              <pre>{entry.text.replace(/\n$/, "")}</pre>
            )}
          </div>
        ))}
      </div>
      <Splitter
        className="input-edge"
        label="Console typing box height"
        axis="row"
        value={shownInput}
        min={MIN_INPUT}
        max={maxInput}
        step={20}
        onChange={(value) => updateSettings({ consoleInputHeight: value })}
      />
      <div className="console-input-row" style={{ height: shownInput }}>
        <ConsoleInput prompt={pending?.prompt} password={pending?.password ?? false} />
        {/* Folded, the console is its typing box alone, with this way back
            to everything typed there before. */}
        {!open && (
          <button type="button" className="console-toggle" aria-expanded="false" aria-controls="console-log" onClick={() => togglePane("consoleOpen")}>
            {entries.length ? `History, ${entries.length === 1 ? "1 entry" : `${entries.length} entries`}` : "History"}
            <ChevronIcon size={12} />
          </button>
        )}
      </div>
    </section>
    </>
  );
}

function ConsoleInput({ prompt, password }: { prompt?: string; password: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [lines, setLines] = useState(1);
  const [secret, setSecret] = useState("");
  const draft = useStore((state) => state.consoleDraft);
  const asking = prompt !== undefined;
  const labels = useRef(new Compartment());

  // The editor is made once and kept, so the typed text and its undo
  // history survive the console being folded and opened again.
  useEffect(() => {
    if (!host.current) return;
    let historyIndex = -1;
    const setText = (target: EditorView, text: string) =>
      target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length) });

    const submit = (target: EditorView) => {
      const code = target.state.doc.toString();
      runConsole(code).then((outcome) => {
        if (outcome === "incomplete") {
          setText(target, `${code}\n`);
          return;
        }
        setText(target, "");
        historyIndex = -1;
      });
      return true;
    };

    // Up and Down walk the history only from the first or last line, so
    // moving through a multi line entry still works normally.
    const walk = (direction: -1 | 1) => (target: EditorView) => {
      if (completionStatus(target.state)) return false;
      const { state } = target;
      const line = state.doc.lineAt(state.selection.main.head).number;
      const past = getState().history;
      if (direction === -1 && (line !== 1 || !past.length)) return false;
      if (direction === 1 && (line !== state.doc.lines || historyIndex === -1)) return false;
      if (direction === -1) historyIndex = historyIndex === -1 ? past.length - 1 : Math.max(0, historyIndex - 1);
      else historyIndex = historyIndex + 1 >= past.length ? -1 : historyIndex + 1;
      setText(target, historyIndex === -1 ? "" : past[historyIndex]);
      return true;
    };

    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          history(),
          closeBrackets(),
          bracketMatching(),
          rLanguage(),
          syntaxHighlighting(highlight),
          rCompletion(),
          EditorView.lineWrapping,
          labels.current.of([]),
          keymap.of([
            { key: "Enter", run: submit },
            { key: "Shift-Enter", run: insertNewlineAndIndent },
            { key: "ArrowUp", run: walk(-1) },
            { key: "ArrowDown", run: walk(1) },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => update.docChanged && setLines(update.state.doc.lines)),
        ],
      }),
    });
    registerConsoleView(view.current);
    return () => {
      registerConsoleView(null);
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // The name and hint change when R is waiting for an answer.
  useEffect(() => {
    view.current?.dispatch({
      effects: labels.current.reconfigure([
        placeholder(asking ? "Type an answer and press Return" : `Type R code and press Return. ${keyLabel("⌘K")} finds any command.`),
        EditorView.contentAttributes.of({ id: "console-input", "aria-label": asking ? `R is asking: ${prompt}` : "R console input" }),
      ]),
    });
    if (asking) view.current?.focus();
  }, [asking, prompt]);

  // Code the app prepares, such as the line that loads a data file, lands
  // here for the person to read, change, and run.
  useEffect(() => {
    const target = view.current;
    if (!draft || !target) return;
    target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: draft.text }, selection: EditorSelection.cursor(draft.text.length) });
    target.focus();
  }, [draft]);

  return (
    <div className={`console-input ${asking ? "is-asking" : ""}`}>
      <span className="prompt" aria-hidden="true">
        {asking ? prompt || "?" : lines > 1 ? "+" : ">"}
      </span>
      <div ref={host} className="console-editor" hidden={password} />
      {password && (
        <input
          type="password"
          className="console-secret"
          aria-label={prompt || "Answer for R"}
          autoFocus
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            runConsole(secret);
            setSecret("");
          }}
        />
      )}
    </div>
  );
}
