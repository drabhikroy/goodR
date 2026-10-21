// The R prompt under the script: one box to type R straight into, on the
// same side as the script, where the eye already is while writing R. What
// it runs takes the stage on the right and joins its timeline, beside the
// results from the script, so there is one place to look for everything R
// has said, and what was typed sits with the plots and results it made.
//
// The box is a small code editor, so typed R is colored as in the script,
// brackets match, and Tab completes names. Return runs the input when it
// is a whole statement. When it is not, the line continues, as R itself
// shows with a plus sign. Shift Return adds a line without running, and Up
// and Down walk back through what was typed before.

import { closeBrackets, closeBracketsKeymap, completionStatus } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { historyToConsole, historyToScript, runConsole, shortPath, updateSettings } from "../lib/app";
import { keyLabel } from "../lib/commands";
import { rCompletion } from "../lib/completion";
import { highlight, registerConsoleView, rLanguage } from "../lib/editor";
import { getState, useStore } from "../lib/store";
import { SearchIcon } from "./Icons";
import { Splitter } from "./Splitter";

/** The shortest the prompt can be, about three lines, and the tallest. */
const PROMPT_MIN = 88;
const PROMPT_MAX = 480;

/** The prompt, with the folder R is working in written under it. The edge
 * above it drags to make it taller or shorter. */
export function Composer() {
  const pending = useStore((state) => state.pendingInput);
  const workingDir = useStore((state) => state.r.workingDir);
  const saved = useStore((state) => state.settings.consoleInputHeight);
  const height = Math.min(PROMPT_MAX, Math.max(PROMPT_MIN, saved));
  // Hidden rather than removed, so what was being typed is still there
  // when the prompt comes back.
  const shown = useStore((state) => state.settings.showPrompt);
  return (
    <div className="composer" hidden={!shown}>
      <Splitter className="composer-edge" label="R prompt height" axis="row" value={height} min={PROMPT_MIN} max={PROMPT_MAX} onChange={(value) => updateSettings({ consoleInputHeight: value })} />
      <div className="composer-box" style={{ height }}>
        <ConsoleInput prompt={pending?.prompt} password={pending?.password ?? false} />
      </div>
      {workingDir && <p className="composer-folder muted truncate">R is working in {shortPath(workingDir)}</p>}
    </div>
  );
}

/** What was typed in the console, newest first, with a way to send each
 * command back to the console or into the script, as RStudio's History
 * pane does. It opens as a sheet over the canvas. */
export function HistoryList() {
  const history = useStore((state) => state.history);
  const [query, setQuery] = useState("");
  const shown = [...history].reverse().filter((code) => code.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <section className="history-pane" aria-label="Console history">
      <div className="pane-toolbar">
        <label className="pane-search">
          <SearchIcon size={14} />
          <input id="history-search" type="search" aria-label="Search the history" placeholder="Search the history" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {history.length === 0 && <p className="muted pane-empty">Commands typed in the console are listed here. Send one back to the console, or into your script.</p>}
      {history.length > 0 && shown.length === 0 && <p className="muted pane-empty">Nothing in the history matches.</p>}
      <ul className="history-list">
        {shown.map((code) => (
          <li key={code} className="history-row">
            <pre className="history-code">{code}</pre>
            <div className="history-actions">
              <button type="button" className="button small quiet" onClick={() => historyToConsole(code)}>
                To console
              </button>
              <button type="button" className="button small quiet" onClick={() => historyToScript(code)}>
                To script
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
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
        placeholder(asking ? "Type an answer and press Return" : `Type R and press Return. ${keyLabel("⌘K")} finds any command.`),
        EditorView.contentAttributes.of({ id: "console-input", "aria-label": asking ? `R is asking: ${prompt}` : "R console input" }),
      ]),
    });
    if (asking) view.current?.focus();
  }, [asking, prompt]);

  // Code the app prepares, such as the line that loads a data file, lands
  // here for the user to read, change, and run.
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
