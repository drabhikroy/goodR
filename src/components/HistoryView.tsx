// History: a script then and now, side by side, over the whole window.
//
// Each kept version is a card. The one being compared sits in front on the
// left, in History's "then" color with a dashed edge, and older versions
// stack behind it, so how far back history goes shows at a glance. Moving
// the slider, or pressing the left and right arrows, flips one card at a
// time: the front card lifts away and the next one slides forward. The
// script now stays still on the right, in its "now" color with a solid
// edge, so only the past moves and the two never rest on color alone.
// Lines that match fold away, each change is named for its section, and a
// thin ruler down the right shows where every change sits in the whole
// file. The second tab holds the commands typed at the console.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  const nowScroller = useRef<HTMLDivElement>(null);
  const deck = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLElement>(null);
  // Which way the last flip went, so the new front card arrives from the
  // right place: from the stack when going back, from the front when not.
  const [arriving, setArriving] = useState<"older" | "newer" | null>(null);
  const at = Math.min(current, Math.max(0, changes.length - 1));

  // A new version to compare with starts at its first change, and its card
  // opens where the script now is scrolled to, so the eye stays in place.
  useEffect(() => setCurrent(0), [chosen]);
  // Focus that was on the card that flipped away moves to the new one, so
  // the arrows keep flipping.
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (scroller.current && nowScroller.current) scroller.current.scrollTop = nowScroller.current.scrollTop;
    if (refocus.current) scroller.current?.focus({ preventScroll: true });
    refocus.current = false;
  }, [chosen]);

  // The two panes scroll as one. Each follows the other only when they
  // differ, so they never chase each other.
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && Math.abs(to.scrollTop - from.scrollTop) > 1) to.scrollTop = from.scrollTop;
  };

  // Flipping to another version. Unless motion is reduced, a copy of the
  // card in front stays behind for a moment and lifts away, forward when
  // going back in time and into the stack when coming forward, while the
  // new card slides into place.
  const choose = (index: number) => {
    if (index === chosen || index < 0 || index >= versions.length) return;
    const older = index > chosen;
    const still = document.documentElement.dataset.motion === "reduce";
    const card = front.current;
    refocus.current = Boolean(card?.contains(document.activeElement));
    if (!still && card && deck.current) {
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.classList.remove("is-arriving-older", "is-arriving-newer");
      ghost.classList.add("tn-card-leaving", older ? "is-leaving-older" : "is-leaving-newer");
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      ghost.removeAttribute("aria-label");
      const top = card.querySelector<HTMLElement>(".tn-pane-scroll")?.scrollTop ?? 0;
      deck.current.appendChild(ghost);
      const pane = ghost.querySelector<HTMLElement>(".tn-pane-scroll");
      if (pane) pane.scrollTop = top;
      const done = () => ghost.remove();
      ghost.addEventListener("animationend", done, { once: true });
      window.setTimeout(done, 700);
    }
    setArriving(still ? null : older ? "older" : "newer");
    setChosen(index);
  };

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
  const flip = useRef(choose);
  flip.current = choose;
  const picked = useRef(chosen);
  picked.current = chosen;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Left goes back in time and right comes forward, unless the arrows
      // already mean something where focus is, as in a text field, the
      // slider, or the tabs.
      const target = event.target as HTMLElement | null;
      const taken = target?.closest("input, textarea, select, [role=tab], [contenteditable=true]");
      if (!event.altKey && !event.metaKey && !event.ctrlKey && !taken && target?.closest(".then-now") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        flip.current(picked.current + (event.key === "ArrowLeft" ? 1 : -1));
        return;
      }
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

  // Up to three older versions show behind the front card.
  const behind = Array.from({ length: Math.min(3, versions.length - 1 - chosen) }, (_, depth) => chosen + 1 + depth);

  // The rows of one side. Both sides are made from the same pieces, so a
  // line, a fold, or a change sits at the same height in each and the two
  // panes line up as they scroll together.
  const rowsFor = (side: "then" | "now"): ReactNode =>
    comparison.segments.map((segment) => {
      if (segment.kind === "same") return <SameRows key={segment.key} lines={segment.lines} side={side} />;
      if (segment.kind === "fold") {
        const shown = open.has(segment.key);
        const first = segment.lines[0].now + 1;
        const last = segment.lines[segment.lines.length - 1].now + 1;
        const words = shown ? `Fold these ${segment.lines.length} lines again` : `${segment.lines.length} unchanged ${segment.lines.length === 1 ? "line" : "lines"}, ${first} to ${last}`;
        return (
          <Fragment key={segment.key}>
            {side === "then" ? (
              <button type="button" className="fold-button" aria-expanded={shown} onClick={() => toggle(segment.key)}>
                {words}
              </button>
            ) : (
              // The same fold on the right, for the pointer; the button on
              // the left is the one the keyboard and screen readers meet.
              <div className="fold-button" aria-hidden="true" onClick={() => toggle(segment.key)}>
                {words}
              </div>
            )}
            {shown && <SameRows lines={segment.lines} side={side} />}
          </Fragment>
        );
      }
      return <ChangeRows key={segment.key} segment={segment} side={side} count={changes.length} current={segment.index === at} onPick={() => setCurrent(segment.index)} />;
    });

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
              {changes[at]?.section && <span className="change-section">, in {changes[at].section}</span>}
            </span>
            <button type="button" className="icon-button" aria-label="Next change" aria-keyshortcuts="F7" disabled={at >= changes.length - 1} onClick={() => go(at + 1)}>
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </div>

      <div className="then-now-frame">
        <div className="tn-deck" ref={deck} style={{ ["--stack" as string]: `${behind.length * 1.4}rem` }}>
          {behind.map((index, depth) => (
            <div
              key={versions[index].id}
              className={`tn-card-behind depth-${depth + 1} ${marks[index] === "failed" ? "is-failed" : ""}`}
              aria-hidden="true"
              title={`Go back to ${whenWords(versions[index].savedAt)}`}
              onClick={() => choose(index)}
            >
              <span className="tn-behind-mark">{marks[index] === "failed" ? "✕" : marks[index] === "ran" ? "✓" : ""}</span>
            </div>
          ))}
          <section
            key={version.id}
            ref={front}
            className={`tn-card ${arriving ? `is-arriving-${arriving}` : ""}`}
            aria-label={`Then, ${thenLabel}`}
            onAnimationEnd={() => setArriving(null)}
          >
            <header className="tn-card-head">
              <span className="history-key is-then-solid" aria-hidden="true" />
              <span className="tn-card-when">Then, {whenWords(version.savedAt)}</span>
              {marks[chosen] && (
                <span className={`tn-card-outcome ${marks[chosen] === "failed" ? "is-failed" : ""}`}>
                  <span aria-hidden="true">{marks[chosen] === "failed" ? "✕ " : "✓ "}</span>
                  {marks[chosen] === "failed" ? "a line did not run" : "ran without problems"}
                </span>
              )}
              <span className="tn-card-count">{changes.length === 0 ? "the same as now" : `${changes.length} ${changes.length === 1 ? "change" : "changes"} from now`}</span>
            </header>
            <div className="tn-pane-scroll" ref={scroller} tabIndex={0} aria-label="The script then, line by line" onScroll={() => follow(scroller.current, nowScroller.current)}>
              {rowsFor("then")}
            </div>
            <footer className="tn-card-foot">
              {changes[at] && (
                <>
                  <button type="button" className="button primary" aria-label={`${changes[at].piece.kind === "added" ? "Take out" : "Put back"} change ${at + 1}`} onClick={() => undoChange(changes[at].piece)}>
                    {changes[at].piece.kind === "added" ? "Take out this change" : "Put back this change"}
                  </button>
                  {changes[at].piece.before.length > 0 && (
                    <button type="button" className="button quiet" aria-label={`Copy then, change ${at + 1}`} onClick={() => copyLines(changes[at].piece.before.join("\n"))}>
                      Copy
                    </button>
                  )}
                </>
              )}
              <span className="tn-card-foot-gap" />
              <button type="button" className="button quiet" disabled={!changes.length} onClick={() => restoreVersion(path, version.text)}>
                Use this whole version
              </button>
            </footer>
          </section>
        </div>
        <section className="tn-now" aria-label="The script now">
          <header className="tn-card-head">
            <span className="history-key is-now" aria-hidden="true" />
            <span className="tn-card-when">Now</span>
            <span className="tn-card-count">what you have open</span>
          </header>
          <div className="tn-pane-scroll" ref={nowScroller} tabIndex={0} aria-label="The script now, line by line" onScroll={() => follow(nowScroller.current, scroller.current)}>
            {rowsFor("now")}
          </div>
        </section>
        {changes.length > 0 && <Ruler changes={changes} lines={comparison.lines} current={at} onPick={go} />}
      </div>

      <div className="then-now-foot">
        <VersionSlider versions={versions} chosen={chosen} marks={marks} onChoose={choose} />
        <div className="button-row then-now-actions">
          <button type="button" className="button quiet" disabled={ran < 0 || ran === chosen} onClick={() => choose(ran)}>
            Last version that ran
          </button>
          <button type="button" className="button quiet" onClick={() => copyLines(version.text)}>
            Copy this version
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lines that match, on one side. */
function SameRows({ lines, side }: { lines: { then: number; now: number; text: string }[]; side: "then" | "now" }) {
  return (
    <>
      {lines.map((line) => (
        <Code key={`${line.then}-${line.now}`} line={{ n: side === "then" ? line.then : line.now, text: line.text }} />
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

/** One side of a change: its lines then, or its lines now, padded so the
 * two sides stay level. The change in hand is marked on both sides, and
 * the buttons at the foot of the card act on it; a click picks another. */
function ChangeRows({ segment, side, count, current, onPick }: { segment: Extract<Segment, { kind: "change" }>; side: "then" | "now"; count: number; current: boolean; onPick: () => void }) {
  const { piece, then, now, index, section } = segment;
  const rows = Math.max(then.length, now.length);
  const kind = piece.kind === "added" ? "lines added" : piece.kind === "removed" ? "lines taken out" : "";
  const title = `Change ${index + 1} of ${count}${section ? `, in ${section}` : ""}${kind ? `, ${kind}` : ""}`;
  const lines = side === "then" ? then : now;
  const body = Array.from({ length: rows }, (_, row) => <Code key={row} line={lines[row] ?? null} kind={side} />);
  if (side === "now") {
    return (
      <div className={`tn-change ${current ? "is-current" : ""}`} role="group" aria-label={`${title}, now`} onClick={onPick}>
        {body}
      </div>
    );
  }
  return (
    <section className={`tn-change ${current ? "is-current" : ""}`} data-change={index} aria-label={title} onClick={onPick}>
      {body}
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
