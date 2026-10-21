// The two editing dialogs: Rename, which shows every place a name will
// change before anything changes, and Find in all files, which lists each
// matching line under its file and opens the file at the line chosen.
//
// Both use the shared modal frame, so focus, Tab, and Escape behave as in
// every other dialog.

import { useEffect, useMemo, useState } from "react";
import { announce, notify, openDialog, openUrl } from "../lib/app";
import { applyRename, currentRenameTarget, findInFiles, openMatch, renamePreview, searchableFiles, type FileMatches } from "../lib/editing";
import { isPlainName } from "../lib/rename";
import { citeDoi, doiIn, searchWorks, type Work } from "../lib/cite";
import type { Step } from "../lib/lineage";
import { currentQuestion, currentTrace, goToStep, rerunAfter, traceInput, traceOf, type TraceTarget } from "../lib/trace";
import { questionText } from "../lib/question";
import { applyProblemFixes, currentProblems, type Problem } from "../lib/fixProblems";
import * as editor from "../lib/editor";
import { copyLines, currentVersions, putBack, restoreVersion, savedWhen } from "../lib/fileHistory";
import { changeSummary, lineDiff, type Piece } from "../lib/lineDiff";
import { Modal } from "./Dialogs";

const close = () => openDialog(null);

/** Rename: the new name, why it cannot be used when it cannot, and every
 * line it changes. */
export function RenameDialog() {
  const target = currentRenameTarget();
  const [name, setName] = useState(target?.name ?? "");
  const preview = useMemo(() => (target ? renamePreview(target) : null), [target]);
  if (!target || !preview) return null;
  const trimmed = name.trim();
  // Each problem is said before the button can be pressed, never after.
  const problem =
    trimmed === target.name
      ? ""
      : !trimmed
        ? "Type the new name."
        : !isPlainName(trimmed)
          ? "A name starts with a letter, or a dot not followed by a number, and holds only letters, numbers, dots, and underscores."
          : preview.taken(trimmed)
            ? `${trimmed} is already used in this file. Renaming to it would make the two mean the same thing.`
            : "";
  const ready = trimmed !== target.name && !problem;
  const count = preview.places.length;
  return (
    <Modal title={`Rename ${target.name}`} onClose={close}>
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) applyRename(target, trimmed);
        }}
      >
        <label className="field">
          <span>New name</span>
          <input data-autofocus value={name} spellCheck={false} aria-describedby="rename-problem rename-count" onChange={(event) => setName(event.target.value)} onFocus={(event) => event.target.select()} />
        </label>
        <p id="rename-problem" className="form-note" role="status">
          {problem}
        </p>
        <p id="rename-count" className="hint">
          Changes {count} {count === 1 ? "place" : "places"} in this file. Text, comments, columns after $, and argument names such as data = stay as they are.
        </p>
        <ol className="rename-lines" aria-label="Lines that change">
          {preview.lines.slice(0, 12).map((item) => (
            <li key={item.line}>
              <span className="muted">Line {item.line + 1}</span>
              <code>{item.text.trim()}</code>
            </li>
          ))}
        </ol>
        {preview.lines.length > 12 && <p className="hint">And {preview.lines.length - 12} more lines.</p>}
        <div className="dialog-foot">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!ready}>
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Find in all files: what to find, two options, and the lines found,
 * grouped by file. */
export function FindInFilesDialog() {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [found, setFound] = useState<{ files: FileMatches[]; more: boolean } | null>(null);
  const fileCount = useMemo(() => searchableFiles().length, []);

  // Searching waits for a short pause in typing, and a later search
  // replaces an earlier one that finishes after it.
  useEffect(() => {
    if (!query) {
      setFound(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      findInFiles(query, matchCase, wholeWord).then((result) => current && setFound(result));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, matchCase, wholeWord]);

  const total = found?.files.reduce((sum, file) => sum + file.matches.length, 0) ?? 0;
  return (
    <Modal title="Find in all files" onClose={close} wide>
      <div className="dialog-body find-files">
        <label className="field">
          <span>Find</span>
          <input data-autofocus type="search" value={query} spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="checks row">
          <label className="check">
            <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
            <span>Match case</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
            <span>Whole names only</span>
          </label>
        </div>
        <p className="hint" role="status">
          {!query
            ? `Looks through ${fileCount} ${fileCount === 1 ? "file" : "files"}: the ones open, and in a project, every script in it.`
            : found === null
              ? "Looking"
              : total === 0
                ? "Not found in any file."
                : `${found.more ? "The first " : ""}${total} ${total === 1 ? "line" : "lines"} in ${found.files.length} ${found.files.length === 1 ? "file" : "files"}.`}
        </p>
        {found && found.files.length > 0 && (
          <div className="find-results">
            {found.files.map((file) => (
              <section key={file.path} aria-label={file.name}>
                <h3>
                  {file.name} <span className="muted">{file.matches.length}</span>
                </h3>
                <ul>
                  {file.matches.map((match) => (
                    <li key={match.line}>
                      <button type="button" onClick={() => openMatch(file.path, match)}>
                        <span className="muted find-line">{match.line + 1}</span>
                        <code>
                          {match.text.slice(0, match.col).trimStart()}
                          <mark>{match.match}</mark>
                          {match.text.slice(match.col + match.match.length)}
                        </code>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Insert citation: a DOI cites at once, and other words search Crossref
 * for works to choose from. */
export function CiteDialog() {
  const [query, setQuery] = useState("");
  const [works, setWorks] = useState<Work[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const doi = doiIn(query);

  async function lookUp() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setProblem("");
    if (doi) {
      setProblem((await citeDoi(doi)) ?? "");
    } else {
      const found = await searchWorks(query.trim());
      if (typeof found === "string") setProblem(found);
      else setWorks(found);
    }
    setBusy(false);
  }

  async function cite(work: Work) {
    setBusy(true);
    setProblem((await citeDoi(work.doi)) ?? "");
    setBusy(false);
  }

  return (
    <Modal title="Insert citation" onClose={close} wide>
      <form
        className="dialog-body cite"
        onSubmit={(event) => {
          event.preventDefault();
          lookUp();
        }}
      >
        <label className="field">
          <span>DOI, or words from the title</span>
          <span className="field-inline">
            <input data-autofocus type="search" value={query} spellCheck={false} onChange={(event) => (setQuery(event.target.value), setWorks(null))} />
            <button type="submit" className="button primary" disabled={!query.trim() || busy}>
              {doi ? "Cite" : "Search"}
            </button>
          </span>
        </label>
        <p className="hint" role="status">
          {busy
            ? "Looking it up"
            : problem ||
              (works === null
                ? "A DOI is cited at once. Other words search Crossref, which lists most published articles and books."
                : works.length
                  ? `${works.length} ${works.length === 1 ? "work" : "works"} found. Choose the one to cite.`
                  : "Nothing found. Try fewer words, or the DOI.")}
        </p>
        {works && works.length > 0 && (
          <ul className="cite-works">
            {works.map((work) => (
              <li key={work.doi}>
                <button type="button" disabled={busy} onClick={() => cite(work)}>
                  <strong>{work.title}</strong>
                  <span className="muted">{[work.authors, work.year, work.journal].filter(Boolean).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Modal>
  );
}

/** One step in the trace: its line, whether it makes or changes the name
 * and which columns, and its first lines of code. */
function TraceStep({ path, step, name }: { path: string; step: Step; name: string }) {
  const made = step.makes.includes(name);
  const columns = step.columns[name] ?? [];
  const code = step.code.split("\n");
  return (
    <li>
      <button type="button" className="trace-line" onClick={() => goToStep(path, step.from)}>
        Line {step.from + 1}
      </button>
      <div>
        <span className="trace-kind">
          {made ? "Makes it" : "Changes it"}
          {columns.length > 0 && `, ${columns.length === 1 ? "column" : "columns"} ${columns.join(", ")}`}
        </span>
        <pre>{code.slice(0, 3).join("\n") + (code.length > 3 ? "\n..." : "")}</pre>
      </div>
    </li>
  );
}

/** Where did this come from: the lines behind a name, what it was made
 * from, and the lines after it that depend on it. */
export function TraceDialog() {
  const [trace, setTrace] = useState<TraceTarget | null>(currentTrace());
  const [history, setHistory] = useState<TraceTarget[]>([]);
  if (!trace) return null;
  const { behind, inputs, after } = traceOf(trace);
  const follow = (name: string) => {
    traceInput(name);
    setHistory([...history, trace]);
    setTrace(currentTrace());
  };
  const back = () => {
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setTrace(previous);
  };
  const file = trace.path.split(/[\\/]/).pop();
  return (
    <Modal title={`Where ${trace.name} came from`} onClose={close} wide>
      <div className="dialog-body trace">
        {history.length > 0 && (
          <button type="button" className="button small quiet" onClick={back}>
            Back to {history[history.length - 1].name}
          </button>
        )}
        <p className="hint">Read from {file}. Code typed at the R prompt is not part of it.</p>
        <h3>Made and changed</h3>
        <ol className="trace-steps">
          {behind.map((step) => (
            <TraceStep key={step.from} path={trace.path} step={step} name={trace.name} />
          ))}
        </ol>
        {inputs.length > 0 && (
          <>
            <h3>Made from</h3>
            <div className="trace-inputs">
              {inputs.map((name) => (
                <button key={name} type="button" className="button small" onClick={() => follow(name)}>
                  Where {name} came from
                </button>
              ))}
            </div>
          </>
        )}
        <h3>Used afterward</h3>
        {after.length === 0 ? (
          <p className="hint">Nothing later in {file} uses {trace.name}.</p>
        ) : (
          <>
            <p className="hint">
              {after.length === 1 ? "One line uses" : `${after.length} lines use`} {trace.name}, directly or through something made from it. After changing it, these are the lines to run again.
            </p>
            <ul className="trace-after">
              {after.map((step) => (
                <li key={step.from}>
                  <button type="button" className="trace-line" onClick={() => goToStep(trace.path, step.from)}>
                    Line {step.from + 1}
                  </button>
                  <code>{step.code.split("\n")[0]}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={close}>
          Close
        </button>
        {after.length > 0 && (
          <button type="button" className="button primary" onClick={() => rerunAfter(trace)}>
            Run {after.length === 1 ? "that line" : `those ${after.length} lines`} again
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Ask for help online: the question written from a failed statement, to
 * read, edit, and copy into a forum. Nothing is sent from here; the
 * person pastes it themselves, after reading what it holds. */
export function AskOnlineDialog() {
  const question = currentQuestion();
  const samples = question?.about ? Object.keys(question.plan.roots).filter((name) => question.about!.data[name]) : [];
  const [withData, setWithData] = useState(samples.length > 0);
  const [text, setText] = useState(() => (question ? questionText(question.plan, question.error, question.about, withData) : ""));
  if (!question) return null;
  const toggle = (on: boolean) => {
    setWithData(on);
    setText(questionText(question.plan, question.error, question.about, on));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied the question. Paste it into a new post.");
    } catch {
      notify("The question could not be copied.", "error");
    }
  };
  return (
    <Modal title="Ask for help online" onClose={close} wide>
      <div className="dialog-body ask-online">
        <p className="hint">
          Forums answer fastest when anyone can run the code and see the error. This has the lines that led to it, the error, and your versions. Fill in what you expected, then copy it.
        </p>
        {samples.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={withData} onChange={(event) => toggle(event.target.checked)} />
            <span>
              Include a sample of {samples.join(", ")}, the first rows only, in place of the lines that make {samples.length === 1 ? "it" : "them"}, so others can run the code without your files. Check it holds nothing private.
            </span>
          </label>
        )}
        <label className="field">
          <span>The question</span>
          <textarea className="ask-online-text" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} />
        </label>
      </div>
      <div className="dialog-foot">
        <button type="button" className="button quiet" onClick={() => openUrl("posit")}>
          Open Posit Community
        </button>
        <button type="button" className="button quiet" onClick={() => openUrl("stackoverflow")}>
          Open Stack Overflow
        </button>
        <button type="button" className="button primary" onClick={copy}>
          Copy the question
        </button>
      </div>
    </Modal>
  );
}

const PROBLEM_KINDS: Record<Problem["kind"], string> = { outdated: "Retired code", habit: "Habit", failed: "Did not run" };

/** One problem: where it is, what is wrong, and the line before and after
 * the fix, so the change can be judged before it is made. */
function ProblemRow({ path, problem, chosen, onToggle }: { path: string; problem: Problem; chosen: boolean; onToggle: (on: boolean) => void }) {
  const line = editor.getText(path).split("\n")[problem.line] ?? "";
  const after = problem.fix === undefined ? null : line.slice(0, problem.from) + problem.fix + line.slice(problem.to);
  const where = (
    <button type="button" className="trace-line" onClick={() => goToStep(path, problem.line)}>
      Line {problem.line + 1}
    </button>
  );
  return (
    <li className={`problem-row kind-${problem.kind}`}>
      {after !== null ? <input type="checkbox" checked={chosen} aria-label={`Fix line ${problem.line + 1}: ${problem.title}`} onChange={(event) => onToggle(event.target.checked)} /> : <span aria-hidden="true" />}
      <div className="problem-body">
        <p className="problem-title">
          {where}
          <span className="problem-kind">{PROBLEM_KINDS[problem.kind]}</span>
          <strong>{problem.title}</strong>
        </p>
        <p className="hint">{problem.detail}</p>
        {after !== null && (
          <div className="problem-change">
            <pre className="problem-before" aria-label="Now">
              <code>
                {line.slice(0, problem.from)}
                <del>{line.slice(problem.from, problem.to)}</del>
                {line.slice(problem.to)}
              </code>
            </pre>
            <pre className="problem-after" aria-label="After the fix">
              <code>
                {line.slice(0, problem.from)}
                <ins>{problem.fix}</ins>
                {line.slice(problem.to)}
              </code>
            </pre>
          </div>
        )}
      </div>
    </li>
  );
}

/** Fix problems: the problems in a script that have a sure fix, ticked to
 * be made together, and those that need a person, with where they are. */
export function FixProblemsDialog() {
  const found = currentProblems();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((found?.problems ?? []).filter((problem) => problem.fix !== undefined).map((problem) => problem.id)));
  if (!found) return null;
  const fixable = found.problems.filter((problem) => problem.fix !== undefined);
  const manual = found.problems.filter((problem) => problem.fix === undefined);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };
  const picked = fixable.filter((problem) => chosen.has(problem.id));
  return (
    <Modal title="Fix problems" onClose={close} wide>
      <div className="dialog-body fix-problems">
        {fixable.length > 0 && (
          <>
            <h3>{fixable.length === 1 ? "One can be fixed for you" : `${fixable.length} can be fixed for you`}</h3>
            <p className="hint">Each fix changes only what is marked, and keeps what the code does. Untick any you want to leave as they are.</p>
            <ul className="problem-list">
              {fixable.map((problem) => (
                <ProblemRow key={problem.id} path={found.path} problem={problem} chosen={chosen.has(problem.id)} onToggle={(on) => toggle(problem.id, on)} />
              ))}
            </ul>
          </>
        )}
        {manual.length > 0 && (
          <>
            <h3>{manual.length === 1 ? "One needs a look from you" : `${manual.length} need a look from you`}</h3>
            <ul className="problem-list">
              {manual.map((problem) => (
                <ProblemRow key={problem.id} path={found.path} problem={problem} chosen={false} onToggle={() => {}} />
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={close}>
          {fixable.length ? "Cancel" : "Close"}
        </button>
        {fixable.length > 0 && (
          <button type="button" className="button primary" disabled={!picked.length} onClick={() => applyProblemFixes(found.path, picked)}>
            {picked.length === 1 ? "Fix 1 problem" : `Fix ${picked.length} problems`}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** One changed part: the lines as they were and as they are, marked, with
 * a way to copy the old lines or put them back. */
function ChangePiece({ piece, onPutBack }: { piece: Exclude<Piece, { kind: "same" }>; onPutBack: () => void }) {
  const where = piece.after.length ? `Line ${piece.newFrom + 1}${piece.after.length > 1 ? ` to ${piece.newFrom + piece.after.length}` : ""} now` : `Before line ${piece.newFrom + 1} now`;
  const label = { added: "Added since", removed: "Taken out since", changed: "Changed since" }[piece.kind];
  return (
    <li className={`change-piece is-${piece.kind}`}>
      <p className="change-head">
        <strong>{label}</strong>
        <span className="muted">{where}</span>
      </p>
      {piece.before.length > 0 && (
        <pre className="change-old" aria-label="Then">
          {piece.before.map((line, index) => (
            <div key={index}>
              <span aria-hidden="true">{"\u2212 "}</span>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
      {piece.after.length > 0 && (
        <pre className="change-new" aria-label="Now">
          {piece.after.map((line, index) => (
            <div key={index}>
              <span aria-hidden="true">{"+ "}</span>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
      <div className="button-row">
        {piece.before.length > 0 && (
          <button type="button" className="button small quiet" onClick={() => copyLines(piece.before.join("\n"))}>
            Copy the old {piece.before.length === 1 ? "line" : "lines"}
          </button>
        )}
        <button type="button" className="button small quiet" onClick={onPutBack}>
          {piece.kind === "added" ? "Take this out" : piece.kind === "removed" ? "Put this back" : "Put the old lines back"}
        </button>
      </div>
    </li>
  );
}

/** Earlier versions of a file: each save on the left, and on the right what
 * has changed since the one chosen, part by part. */
export function FileHistoryDialog() {
  const found = currentVersions();
  const [chosen, setChosen] = useState(0);
  // Bumped after a part is put back, so the comparison is made again.
  const [, setEdits] = useState(0);
  if (!found) return null;
  const now = editor.getText(found.path);
  const version = found.versions[chosen];
  const pieces = lineDiff(version.text, now);
  const changes = pieces.filter((piece): piece is Exclude<Piece, { kind: "same" }> => piece.kind !== "same");
  const file = found.path.split(/[\\/]/).pop();
  return (
    <Modal title={`Earlier versions of ${file}`} onClose={close} wide className="history-dialog">
      <div className="dialog-body file-history">
        <div className="version-list" role="group" aria-label="Saved versions">
          {found.versions.map((item, index) => {
            const summary = changeSummary(lineDiff(item.text, now));
            return (
              <button key={item.id} type="button" aria-pressed={index === chosen} className={`version-item${index === chosen ? " is-chosen" : ""}`} onClick={() => setChosen(index)}>
                <span className="version-when">{savedWhen(item.savedAt)}</span>
                <span className="version-summary">{summary === "No changes" ? "Same as now" : summary}</span>
              </button>
            );
          })}
        </div>
        <div className="version-changes">
          <p className="version-lead">
            {changes.length ? (
              <>
                Compared with the version from <strong>{savedWhen(version.savedAt)}</strong>: {changeSummary(pieces).toLowerCase()}.
              </>
            ) : (
              "The script is the same now as in this version."
            )}
          </p>
          {changes.length > 0 && (
            <ul className="change-list">
              {changes.map((piece) => (
                <ChangePiece
                  key={`${piece.oldFrom}-${piece.newFrom}`}
                  piece={piece}
                  onPutBack={() => {
                    putBack(found.path, piece);
                    setEdits((count) => count + 1);
                    announce(piece.kind === "added" ? "Taken out of the script." : "Put back in the script.");
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="dialog-foot">
        <button type="button" className="button quiet" onClick={() => copyLines(version.text)}>
          Copy this version
        </button>
        <button type="button" className="button" onClick={close}>
          Close
        </button>
        <button type="button" className="button primary" disabled={!changes.length} onClick={() => restoreVersion(found.path, version.text)}>
          Use this version
        </button>
      </div>
    </Modal>
  );
}
