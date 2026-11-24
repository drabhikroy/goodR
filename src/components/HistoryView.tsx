// History: a script then and now, side by side, over the whole window.
//
// The earlier version is on the left in History's "then" color with a
// dashed edge, and the script now on the right in its "now" color with a
// solid edge, so the two never rest on color alone. Lines that match fold
// away, each change is named for its section, and a thin ruler down the
// right shows where every change sits in the whole file. A slider along
// the foot walks back through the kept versions, marking the ones where a
// line failed. The second tab holds the commands typed at the console.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { announce, baseName, openDialog } from "../lib/app";
import * as editor from "../lib/editor";
import { clockTime, copyLines, currentVersions, openingTab, putBack, restoreVersion, savedWhen, sectionsOf, whenWords, type HistoryTab, type Versions } from "../lib/fileHistory";
import { compare, describe, firstChoice, lastRan, outcomes, type Change, type Line, type Segment } from "../lib/thenNow";
import { useStore } from "../lib/store";
import { HistoryList } from "./Composer";
import { Modal } from "./Dialogs";

const close = () => openDialog(null);

export function HistoryView() {
  const found = currentVersions();
  const [tab, setTab] = useState<HistoryTab>(openingTab());
  const file = found ? baseName(found.path) : null;
  const tabs: { id: HistoryTab; label: string }[] = [
    { id: "script", label: file ? `This script` : "Scripts" },
    { id: "commands", label: "Commands you typed" },
  ];
  // Left and right move between the two tabs, as tabs do.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "script" ? "commands" : "script";
    setTab(next);
    document.getElementById(`history-tab-${next}`)?.focus();
  };
  return (
    <Modal title={file ? `History of ${file}` : "History"} onClose={close} wide className="history-view">
      <div className="history-tabs" role="tablist" aria-label="What to look back at" onKeyDown={onTabKey}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`history-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`history-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            data-autofocus={tab === item.id ? "" : undefined}
            className={`history-tab ${tab === item.id ? "is-on" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "script" ? (
        <div className="history-panel" role="tabpanel" id="history-panel-script" aria-labelledby="history-tab-script">
          <ThenAndNow found={found} />
        </div>
      ) : (
        <div className="history-panel history-commands" role="tabpanel" id="history-panel-commands" aria-labelledby="history-tab-commands">
          <HistoryList onSent={close} />
        </div>
      )}
    </Modal>
  );
}

/** Why there is nothing to compare, in place of the comparison. */
function Empty({ children }: { children: string }) {
  return (
    <div className="dialog-body history-empty">
      <p>{children}</p>
    </div>
  );
}

function ThenAndNow({ found }: { found: Versions | null }) {
  if (!found) return <Empty>Open a saved script to see what it was like before. Each save keeps a version, and so does each run that works.</Empty>;
  if (!found.versions.length) return <Empty>{`No earlier versions of ${baseName(found.path)} yet. Each save from now on keeps one, and so does each run that works.`}</Empty>;
  return <Comparison found={found} />;
}

function Comparison({ found }: { found: Versions }) {
  const { path, versions } = found;
  const blocks = useStore((state) => state.blocks);
  // Bumped after a part is put back, so the comparison is made again.
  const [edits, setEdits] = useState(0);
  const now = useMemo(() => editor.getText(path), [path, edits]);
  const [chosen, setChosen] = useState(() => firstChoice(versions, editor.getText(path)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const version = versions[chosen];
  const marks = useMemo(() => outcomes(path, versions, Object.values(blocks)), [path, versions, blocks]);
  const comparison = useMemo(() => compare(version.text, now, sectionsOf(path, now)), [version, now, path]);
  const changes = comparison.segments.filter((segment): segment is Extract<Segment, { kind: "change" }> => segment.kind === "change");
  const ran = lastRan(versions, now);
  const scroller = useRef<HTMLDivElement>(null);
  const at = Math.min(current, Math.max(0, changes.length - 1));

  // A new version to compare with starts at its first change.
  useEffect(() => setCurrent(0), [chosen]);

  const go = (index: number) => {
    if (!changes.length) return;
    const next = Math.max(0, Math.min(changes.length - 1, index));
    setCurrent(next);
    const target = scroller.current?.querySelector<HTMLElement>(`[data-change="${next}"]`);
    target?.scrollIntoView?.({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
    announce(`Change ${next + 1} of ${changes.length}${changes[next].section ? `, in ${changes[next].section}` : ""}`);
  };

  // F7 and Shift+F7, or Alt with the arrows, step through the changes, as
  // in the diff views people already know. They work wherever focus is in
  // History, even after the last arrow button has gone dim.
  const step = useRef(go);
  step.current = go;
  const where = useRef(at);
  where.current = at;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const forward = (event.key === "F7" && !event.shiftKey) || (event.altKey && event.key === "ArrowDown");
      const back = (event.key === "F7" && event.shiftKey) || (event.altKey && event.key === "ArrowUp");
      if (!forward && !back) return;
      event.preventDefault();
      step.current(where.current + (forward ? 1 : -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const after = (words: string) => {
    setEdits((count) => count + 1);
    announce(words);
  };
  const undoChange = (piece: Change) => {
    putBack(path, piece);
    after(piece.kind === "added" ? "Taken out of the script." : "Put back in the script.");
  };
  const toggle = (key: string) =>
    setOpen((shown) => {
      const next = new Set(shown);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const outcomeWords = (index: number) => (marks[index] === "ran" ? "ran without problems" : marks[index] === "failed" ? "a line did not run" : "");
  const thenLabel = `${whenWords(version.savedAt)}${outcomeWords(chosen) ? `, ${outcomeWords(chosen)}` : ""}`;

  return (
    <div className="then-now">
      <div className="then-now-bar">
        <p className="then-now-summary">{describe(comparison)}</p>
        {changes.length > 0 && (
          <div className="change-steps" role="group" aria-label="Move between changes">
            <button type="button" className="icon-button" aria-label="Previous change" aria-keyshortcuts="Shift+F7" disabled={at === 0} onClick={() => go(at - 1)}>
              <span aria-hidden="true">↑</span>
            </button>
            <span className="change-count" aria-live="polite">
              Change {at + 1} of {changes.length}
            </span>
            <button type="button" className="icon-button" aria-label="Next change" aria-keyshortcuts="F7" disabled={at >= changes.length - 1} onClick={() => go(at + 1)}>
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </div>

      {changes.length === 0 ? (
        <div className="then-now-same">
          <p>The script now is the same as the version from {whenWords(version.savedAt)}. Move the slider to compare with another.</p>
        </div>
      ) : (
        <div className="then-now-frame">
          <div className="then-now-scroll" ref={scroller} tabIndex={0} aria-label="Then and now, line by line">
            <div className="then-now-head" aria-hidden="true">
              <span className="then-now-col is-then">
                <span className="history-key is-then" />
                Then, {thenLabel}
              </span>
              <span />
              <span className="then-now-col is-now">
                <span className="history-key is-now" />
                Now
              </span>
            </div>
            {comparison.segments.map((segment) => {
              if (segment.kind === "same") return <SameRows key={segment.key} lines={segment.lines} />;
              if (segment.kind === "fold") {
                const shown = open.has(segment.key);
                const first = segment.lines[0].now + 1;
                const last = segment.lines[segment.lines.length - 1].now + 1;
                return (
                  <Fragment key={segment.key}>
                    <button type="button" className="fold-button" aria-expanded={shown} onClick={() => toggle(segment.key)}>
                      {shown ? `Fold these ${segment.lines.length} lines again` : `${segment.lines.length} unchanged ${segment.lines.length === 1 ? "line" : "lines"}, ${first} to ${last}`}
                    </button>
                    {shown && <SameRows lines={segment.lines} />}
                  </Fragment>
                );
              }
              return <ChangeRows key={segment.key} segment={segment} count={changes.length} current={segment.index === at} onPutBack={() => undoChange(segment.piece)} />;
            })}
          </div>
          <Ruler changes={changes} lines={comparison.lines} current={at} onPick={go} />
        </div>
      )}

      <div className="then-now-foot">
        <VersionSlider versions={versions} chosen={chosen} marks={marks} onChoose={setChosen} />
        <div className="button-row then-now-actions">
          <button type="button" className="button quiet" disabled={ran < 0 || ran === chosen} onClick={() => setChosen(ran)}>
            Last version that ran
          </button>
          <button type="button" className="button quiet" onClick={() => copyLines(version.text)}>
            Copy this version
          </button>
          <button type="button" className="button primary" disabled={!changes.length} onClick={() => restoreVersion(path, version.text)}>
            Use this whole version
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lines that match, shown once on each side. */
function SameRows({ lines }: { lines: { then: number; now: number; text: string }[] }) {
  return (
    <>
      {lines.map((line) => (
        <div key={`${line.then}-${line.now}`} className="tn-row">
          <Code line={{ n: line.then, text: line.text }} />
          <span />
          <Code line={{ n: line.now, text: line.text }} />
        </div>
      ))}
    </>
  );
}

/** One line of code with its number, in a column. */
function Code({ line, kind }: { line: Line | null; kind?: "then" | "now" }) {
  if (!line) return <span className={`tn-code is-gap`} aria-hidden="true" />;
  return (
    <span className={`tn-code ${kind ? `is-${kind}` : ""}`}>
      <span className="tn-n" aria-hidden="true">
        {line.n + 1}
      </span>
      <span className="tn-text">{line.text || " "}</span>
    </span>
  );
}

/** A change: then on the left, now on the right, and between them the
 * ways to take it back. */
function ChangeRows({ segment, count, current, onPutBack }: { segment: Extract<Segment, { kind: "change" }>; count: number; current: boolean; onPutBack: () => void }) {
  const { piece, then, now, index, section } = segment;
  const rows = Math.max(then.length, now.length);
  const kind = piece.kind === "added" ? "lines added" : piece.kind === "removed" ? "lines taken out" : "";
  const title = `Change ${index + 1} of ${count}${section ? `, in ${section}` : ""}${kind ? `, ${kind}` : ""}`;
  return (
    <section className={`tn-change ${current ? "is-current" : ""}`} data-change={index} aria-label={title}>
      <p className="tn-change-title">{title}</p>
      <div className="tn-change-body">
        <div className="tn-side" role="group" aria-label="Then">
          {Array.from({ length: rows }, (_, row) => (
            <Code key={row} line={then[row] ?? null} kind="then" />
          ))}
        </div>
        <div className="tn-gutter">
          <button type="button" className="button small primary" aria-label={`${piece.kind === "added" ? "Take out" : "Put back"} change ${index + 1}`} onClick={onPutBack}>
            {piece.kind === "added" ? "Take out" : "← Put back"}
          </button>
          {piece.before.length > 0 && (
            <button type="button" className="button small quiet" aria-label={`Copy then, change ${index + 1}`} onClick={() => copyLines(piece.before.join("\n"))}>
              Copy then
            </button>
          )}
        </div>
        <div className="tn-side" role="group" aria-label="Now">
          {Array.from({ length: rows }, (_, row) => (
            <Code key={row} line={now[row] ?? null} kind="now" />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Where every change sits in the whole file, as marks down a thin strip.
 * A mark jumps to its change. It is a shortcut for the pointer: the
 * buttons above step through the same changes from the keyboard. */
function Ruler({ changes, lines, current, onPick }: { changes: Extract<Segment, { kind: "change" }>[]; lines: number; current: number; onPick: (index: number) => void }) {
  return (
    <div className="then-now-ruler" aria-hidden="true">
      {changes.map((change) => {
        const size = Math.max(change.then.length, change.now.length, 1);
        return (
          <span
            key={change.key}
            className={`ruler-mark ${change.index === current ? "is-current" : ""}`}
            title={`Change ${change.index + 1}${change.section ? `, in ${change.section}` : ""}`}
            style={{ top: `${(change.piece.newFrom / Math.max(1, lines)) * 100}%`, height: `max(0.5rem, ${(size / Math.max(1, lines)) * 100}%)` }}
            onClick={() => onPick(change.index)}
          />
        );
      })}
    </div>
  );
}

/** The kept versions, oldest on the left and newest on the right, with a
 * mark under each that ran with a problem. */
function VersionSlider({ versions, chosen, marks, onChoose }: { versions: Versions["versions"]; chosen: number; marks: ("ran" | "failed" | null)[]; onChoose: (index: number) => void }) {
  const count = versions.length;
  // The slider runs oldest to newest; the versions are newest first.
  const position = count - 1 - chosen;
  const indexAt = (value: number) => count - 1 - value;
  const describeAt = (index: number) => `${savedWhen(versions[index].savedAt)}${marks[index] === "ran" ? ", ran without problems" : marks[index] === "failed" ? ", a line did not run" : ""}`;
  if (count < 2) return <p className="then-now-only">One version kept so far: {describeAt(0)}.</p>;
  // Labels for every version would crowd, so only some are written: the
  // ends, the one chosen, and the failures, which are marked anyway.
  const labeled = (index: number) => count <= 6 || index === 0 || index === count - 1 || index === chosen;
  return (
    <div className="version-slider">
      <label className="version-slider-label" htmlFor="history-slider">
        Compare now with
      </label>
      <div className="version-slider-track">
        <input
          id="history-slider"
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={position}
          aria-valuetext={describeAt(chosen)}
          onChange={(event) => onChoose(indexAt(Number(event.target.value)))}
        />
        <div className="version-ticks" aria-hidden="true">
          {versions.map((version, index) => {
            const left = `${((count - 1 - index) / (count - 1)) * 100}%`;
            const failed = marks[index] === "failed";
            if (!labeled(index) && !failed) return null;
            return (
              <span key={version.id} className={`version-tick ${index === chosen ? "is-chosen" : ""} ${failed ? "is-failed" : ""}`} style={{ left }}>
                {failed && <span className="version-fail">✕ </span>}
                {labeled(index) ? clockTime(version.savedAt) : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
