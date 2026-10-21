// One run's result. Under a line, it sits in a well below the code with a
// rule down the left joining the two. Its buttons show on hover or focus,
// and the status line only when there is something to say (running,
// stopped, failed, slow). On the canvas it also carries a copy of its code
// and a link back to the line.

import { useLayoutEffect, useState } from "react";
import type { RunProfile } from "../lib/types";
import { plotKind, readLabels, type PlotKind, type PlotLabels } from "../lib/plotEdit";
import { plotColors } from "../theme/theme";
import { applyFix, copyResult, editPlotCode, installPackages, openExportPlot, runBlockAgain, showPlot, toggleResult, viewPlot } from "../lib/app";
import { askAssistantAboutError } from "../lib/assistant";
import * as editor from "../lib/editor";
import { explainError, userFrames } from "../lib/errors";
import { openAskOnline } from "../lib/trace";
import { isQuiet, SLOW_MS, useStore, type Block, type OutputItem } from "../lib/store";
import { ExerciseResult } from "./ExerciseResult";
import { StatsWriteUp } from "./StatsWriteUp";
import { StreamText } from "./StreamText";
import { WhatChanged } from "./WhatChanged";
import { ChartIcon, CopyIcon, ExpandIcon, EyeIcon, HollowIcon, PauseIcon, PlayIcon, RingIcon, PencilIcon, SaveIcon, SparkIcon, StopIcon, TriangleIcon, UndoIcon } from "./Icons";

function seconds(ms: number) {
  if (ms < 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}


function lineLabel(block: Block, line: number) {
  const span = block.toLine - block.fromLine;
  return span ? `Lines ${line - span + 1} to ${line + 1}` : `Line ${line + 1}`;
}

/** The words for each state that needs saying. A finished result says
 * nothing, since the result itself shows it finished. Shape and words carry
 * the meaning, so color never has to. */
const STATE_WORDS: Record<string, string> = {
  running: "Running",
  error: "This line did not run",
  stopped: "Stopped",
  queued: "Waiting for the line before it",
  skipped: "Did not run, because an earlier line stopped",
};

export function OutputCard({ blockId, showLine = false }: { blockId: string; showLine?: boolean }) {
  const block = useStore((state) => state.blocks[blockId]);
  // CodeMirror measures block widgets once. When a result grows, as output
  // streams in, the editor is asked to measure again so lines below it do
  // not overlap.
  useLayoutEffect(() => editor.requestMeasure());
  if (!block) return null;
  // A statement that ran and printed nothing shows as a check in the gutter
  // instead. Rendering nothing leaves the container empty, which CSS hides.
  if (isQuiet(block)) return null;
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const label = lineLabel(block, line);
  const span = block.toLine - block.fromLine;
  const link = {
    onMouseEnter: () => editor.markLines(block.file, "linked", [line - span, line]),
    onMouseLeave: () => editor.markLines(block.file, "linked", null),
    onFocus: () => editor.markLines(block.file, "linked", [line - span, line]),
    onBlur: () => editor.markLines(block.file, "linked", null),
  };
  const quiet = block.status === "queued" || block.status === "skipped";
  const collapsed = Boolean(block.collapsed);
  const [showTime, setShowTime] = useState(false);
  const done = block.status !== "running" && block.status !== "queued";
  const slow = done && !quiet && block.duration >= SLOW_MS;
  const words = block.undone
    ? "Undone. The objects this run changed are back as they were."
    : block.restored
      ? "From last time. Run it again to work with what it made."
      : STATE_WORDS[block.status];

  return (
    <section
      className={`output-card status-${block.status} ${showLine ? "is-standalone" : ""} ${quiet ? "is-quiet" : ""} ${block.restored ? "is-restored" : ""}`}
      aria-label={`Result of ${label.toLowerCase()}`}
      title={done && !quiet ? `${label}, took ${seconds(block.duration)}` : undefined}
      {...link}
    >
      {showLine && (
        <div className="cell-in">
          {/* On the stage there is room, so Run again, Copy, and Hide sit
              in this row, always in view, rather than floating over the
              result, where they would cover a plot. */}
          <div className="cell-in-head">
            <button type="button" className="cell-line" onClick={() => editor.goToLine(block.file, line)}>
              Go to {label.toLowerCase()}
            </button>
            {done && !quiet && <ResultActions blockId={blockId} block={block} inline />}
          </div>
          <pre className="cell-code">{block.code.split("\n").slice(0, 4).join("\n") + (block.code.split("\n").length > 4 ? "\n..." : "")}</pre>
        </div>
      )}
      <div className={`cell-out ${collapsed ? "is-collapsed" : ""}`}>
        {(words || collapsed || slow) && (
          <header className="output-head">
            {block.status === "running" && <RingIcon size={14} label="Running" />}
            {block.status === "error" && <TriangleIcon size={14} label="Did not run" />}
            {block.status === "stopped" && <StopIcon size={14} label="Stopped" />}
            {quiet && <HollowIcon size={14} />}
            {block.undone && <UndoIcon size={14} />}
            {words && <span className="output-state">{words}</span>}
            {collapsed && <span className="output-state muted">Result hidden</span>}
            {slow && !block.profile && <span className="output-meta">{seconds(block.duration)}</span>}
            {slow && block.profile && (
              <button type="button" className="output-meta is-link" aria-expanded={showTime} onClick={() => setShowTime(!showTime)}>
                {seconds(block.duration)}, see where the time went
              </button>
            )}
          </header>
        )}
        {slow && block.profile && showTime && <TimeSpent profile={block.profile} duration={block.duration} />}
        {done && !quiet && !showLine && <ResultActions blockId={blockId} block={block} />}
        {block.paused && (
          <div className="output-paused">
            <PauseIcon size={14} />
            <span>This took {seconds(block.duration)}, so live output skips it.</span>
            <button type="button" className="button quiet" onClick={() => runBlockAgain(blockId)}>
              Run once
            </button>
          </div>
        )}
        {block.items.length > 0 && !collapsed && (
          <div className="output-body">
            {block.items.map((item, index) => (
              <Item key={index} item={item} blockId={blockId} large={showLine} />
            ))}
          </div>
        )}
        {block.exercise && !collapsed && <ExerciseResult block={block} />}
        {block.compared && !collapsed && (showLine || !block.compared.same) && <WhatChanged diff={block.compared} />}
        {block.stats && !collapsed && <StatsWriteUp report={block.stats} />}
      </div>
    </section>
  );
}

/**
 * Where a slow run spent its time, from R's own sampling while it ran.
 * Each function's time includes the functions it called, so the first is
 * usually the call in the script and the next ones say what inside it was
 * slow. When R was sampled working for only a small part of the time, it
 * was mostly waiting, for a download, a file, or Sys.sleep(), and no
 * function list would explain that, so it says so instead.
 */
function TimeSpent({ profile, duration }: { profile: RunProfile; duration: number }) {
  const waiting = profile.sampled < (duration / 1000) * 0.3;
  return (
    <div className="time-spent" role="group" aria-label="Where the time went">
      {waiting && <p>R spent most of this time waiting rather than working, such as for a download, a large file, or Sys.sleep(). Faster code would not change that much.</p>}
      {profile.calls.length > 0 && (
        <>
          <p className="muted">{waiting ? "While it was working:" : "Time spent in each function, including the functions it called:"}</p>
          <ul>
            {profile.calls.map((call) => (
              <li key={call.name}>
                <code>{call.name}</code>
                <span className="time-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(call.share * 100)}%` }} />
                </span>
                <span className="time-share">
                  {Math.round(call.share * 100)} percent, {seconds(call.seconds * 1000)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Run again, Copy, and Hide, as small labeled icons at the top right of the
 * result. They show while the pointer is over the result or keyboard focus
 * is inside it, so they cost nothing to look at the rest of the time and
 * are never more than one move away.
 */
function ResultActions({ blockId, block, inline = false }: { blockId: string; block: Block; inline?: boolean }) {
  const hasText = block.items.some((item) => item.type !== "plot");
  return (
    <div className={`result-actions ${inline ? "is-inline" : ""}`} role="group" aria-label="Result actions">
      <button type="button" className="result-action" aria-label="Run again" title="Run again" onClick={() => runBlockAgain(blockId)}>
        <PlayIcon size={12} />
      </button>
      {hasText && (
        <button type="button" className="result-action" aria-label="Copy result" title="Copy result" onClick={() => copyResult(blockId)}>
          <CopyIcon size={14} />
        </button>
      )}
      {block.items.length > 0 && (
        <button
          type="button"
          className="result-action"
          aria-label={block.collapsed ? "Show result" : "Hide result"}
          title={block.collapsed ? "Show result" : "Hide result"}
          onClick={() => toggleResult(blockId)}
        >
          <EyeIcon size={14} closed={!block.collapsed} />
        </button>
      )}
    </div>
  );
}

function Item({ item, blockId, large }: { item: OutputItem; blockId: string; large: boolean }) {
  switch (item.type) {
    case "stream":
      return <StreamText text={item.text} name={item.name} />;
    case "value":
      return <pre className="output-text">{item.text}</pre>;
    case "plot":
      // On the stage a plot fills the space it has. Under a line of the
      // script it is a small copy, so a tall picture never pushes the
      // rest of the script out of view. Either opens full size.
      if (large) return <PlotFigure index={item.plot} png={item.png} blockId={blockId} />;
      return (
        <button type="button" className="output-plot" onClick={() => viewPlot(item.plot)} aria-label={`Plot ${item.plot + 1}, view full size`}>
          <img src={`data:image/png;base64,${item.png}`} alt="" />
          <span className="output-plot-note">
            Plot {item.plot + 1} <ChartIcon size={12} /> View full size
          </span>
        </button>
      );
    case "error":
      return <ErrorItem message={item.message} traceback={item.traceback} parsed={item.parsed ?? ""} blockId={blockId} />;
  }
}

/** A plot at the canvas's width, with the things done with a plot,
 * looking closer, changing its labels, and exporting, on its own bar.
 * Labels can be changed only for a plot from the script whose code this
 * can read, since the change is made in that code. */
export function PlotFigure({ index, png, blockId }: { index: number; png: string; blockId?: string }) {
  const code = useStore((state) => (blockId ? (state.blocks[blockId]?.code ?? "") : ""));
  const kind = code ? plotKind(code) : null;
  const [editing, setEditing] = useState(false);
  return (
    <figure className="plot-figure">
      <button type="button" className="plot-figure-image" onClick={() => viewPlot(index)} aria-label={`Plot ${index + 1}, view full size`}>
        <img src={`data:image/png;base64,${png}`} alt="" />
      </button>
      <figcaption className="plot-figure-bar">
        <span className="muted">Plot {index + 1}</span>
        {kind && blockId && (
          <button type="button" className="button small quiet push-end" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            <PencilIcon size={14} /> Edit labels
          </button>
        )}
        <button type="button" className={`button small quiet ${kind && blockId ? "" : "push-end"}`} onClick={() => viewPlot(index)}>
          <ExpandIcon size={14} /> Full size
        </button>
        <button type="button" className="button small quiet" onClick={() => (showPlot(index), openExportPlot())}>
          <SaveIcon size={14} /> Export
        </button>
      </figcaption>
      {editing && kind && blockId && <PlotLabelsForm blockId={blockId} code={code} kind={kind} onDone={() => setEditing(false)} />}
    </figure>
  );
}

/**
 * The title, the axis labels, and for a base R plot the color, as fields
 * filled in from the code. Apply changes the code and draws the plot
 * again. An empty field goes back to the plot's own default.
 */
function PlotLabelsForm({ blockId, code, kind, onDone }: { blockId: string; code: string; kind: PlotKind; onDone: () => void }) {
  const palette = useStore((state) => state.settings.palette);
  const [labels, setLabels] = useState<PlotLabels>(() => readLabels(code));
  const colors = plotColors(palette);
  const set = (key: keyof PlotLabels) => (event: React.ChangeEvent<HTMLInputElement>) => setLabels({ ...labels, [key]: event.target.value });
  return (
    <form
      className="plot-labels"
      aria-label="Plot labels"
      onSubmit={(event) => {
        event.preventDefault();
        editPlotCode(blockId, labels);
        onDone();
      }}
    >
      <label>
        <span>Title</span>
        <input value={labels.title} onChange={set("title")} autoFocus />
      </label>
      <label>
        <span>Horizontal axis</span>
        <input value={labels.x} onChange={set("x")} />
      </label>
      <label>
        <span>Vertical axis</span>
        <input value={labels.y} onChange={set("y")} />
      </label>
      {kind.kind === "base" && kind.colorEditable && (
        <fieldset className="plot-colors">
          <legend>Color</legend>
          <label className="plot-color">
            <input type="radio" name={`color-${blockId}`} checked={!labels.color} onChange={() => setLabels({ ...labels, color: "" })} />
            <span>As it is now</span>
          </label>
          {colors.map((color, at) => (
            <label key={color} className="plot-color">
              <input type="radio" name={`color-${blockId}`} checked={labels.color.toLowerCase() === color.toLowerCase()} onChange={() => setLabels({ ...labels, color })} />
              <span className="plot-swatch" style={{ background: color }} aria-hidden="true" />
              <span className="visually-hidden">Color {at + 1} of the palette, {color}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="hint">{kind.kind === "ggplot" ? "This changes labs() in the code that drew the plot, then draws it again." : "This changes the code that drew the plot, then draws it again."}</p>
      <div className="button-row">
        <button type="submit" className="button primary">
          Apply
        </button>
        <button type="button" className="button quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ErrorItem({ message, traceback, parsed, blockId }: { message: string; traceback: string[]; parsed: string; blockId: string }) {
  const objects = useStore((state) => state.objects);
  const block = useStore((state) => state.blocks[blockId]);
  const assistantReady = useStore((state) => Boolean(state.assistant.model));
  const [showOriginal, setShowOriginal] = useState(false);
  const explained = explainError(message, objects, block?.code ?? "", traceback, parsed);
  const calls = userFrames(traceback);
  const fix = explained.fix;
  const where = explained.where;
  // The statement's own line that failed, and where it sits in the file now.
  const codeLine = where && block ? block.code.split("\n")[where.line] ?? "" : "";
  const current = block ? editor.blockLines(block.file).get(blockId) ?? block.toLine : 0;
  const fileLine = block && where ? current - (block.toLine - block.fromLine) + where.line : 0;
  const marked = codeLine.slice(where?.from ?? 0, where?.to ?? 0);
  return (
    <div className="output-error">
      <p className="error-title">{explained.title}</p>
      <p>{explained.detail}</p>
      {where && block && marked && (
        <figure className="error-where">
          <figcaption>{`Where it went wrong, line ${fileLine + 1}`}</figcaption>
          <pre>
            <code>
              {codeLine.slice(0, where.from)}
              <mark>{marked}</mark>
              {codeLine.slice(where.to)}
            </code>
            {"\n"}
            <span className="error-carets" aria-hidden="true">
              {" ".repeat(where.from)}
              {"^".repeat(Math.max(1, where.to - where.from))}
            </span>
          </pre>
        </figure>
      )}
      {explained.hint && (
        <p className="error-hint">
          <strong>Try this:</strong> {explained.hint}
        </p>
      )}
      <div className="button-row">
        {fix?.kind === "replace" && (
          <button type="button" className="button primary" onClick={() => applyFix(blockId, fix.from, fix.to)}>
            {fix.label}
          </button>
        )}
        {fix?.kind === "install" && (
          <button type="button" className="button primary" onClick={() => installPackages([fix.name])}>
            {fix.label}
          </button>
        )}
        {where && block && marked && (
          <button type="button" className="button quiet" onClick={() => editor.selectSpan(block.file, fileLine, marked, where.from)}>
            Go to the spot
          </button>
        )}
        {assistantReady && (
          <button type="button" className="button quiet" onClick={() => askAssistantAboutError(blockId)}>
            <SparkIcon size={14} /> Ask the assistant
          </button>
        )}
        <button type="button" className="button quiet" onClick={() => openAskOnline(blockId)}>
          Ask for help online
        </button>
        <button type="button" className="button quiet" aria-expanded={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
          {showOriginal ? "Hide the R message" : "Show the R message"}
        </button>
      </div>
      {showOriginal && (
        <pre className="output-text error-original">
          {explained.original}
          {calls.length > 0 && `\n\nCalls, most recent last:\n${calls.join("\n")}`}
        </pre>
      )}
    </div>
  );
}
