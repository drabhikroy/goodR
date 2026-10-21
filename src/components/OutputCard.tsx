// One run's result. Under each line it is a recessed well that sits right
// below the statement's code, joined to it by a shared rule down the left
// edge, so input and output read as one unit (Palmer 1992, common region)
// while the change of surface keeps them apart. Earlier versions framed each
// result as a card with a title bar, labels, and three text buttons. That
// put five rows of controls around a one line answer, and visual complexity
// of that kind lowers both first impressions and measured usability (Tuch
// et al. 2009; Reinecke et al. 2013). The controls now appear on pointer hover
// or keyboard focus, and the status line appears only when there is
// something to say: running, stopped, failed, or slow. In the results
// column, beside or below the code, the well carries a short copy of its
// code and a link back to it.

import { useLayoutEffect, useState } from "react";
import { applyFix, copyResult, installPackages, runBlockAgain, showPlot, toggleResult } from "../lib/app";
import { askAssistantAboutError } from "../lib/assistant";
import * as editor from "../lib/editor";
import { explainError, userFrames } from "../lib/errors";
import { useStore, type Block, type OutputItem } from "../lib/store";
import { CopyIcon, EyeIcon, HollowIcon, PauseIcon, PlayIcon, RingIcon, SparkIcon, StopIcon, TriangleIcon } from "./Icons";

function seconds(ms: number) {
  if (ms < 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

// A run this long is worth a note. Shorter ones would only add noise.
const SLOW_MS = 1000;

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
  if (block.status === "ok" && block.items.length === 0 && !block.paused) return null;
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
  const done = block.status !== "running" && block.status !== "queued";
  const slow = done && !quiet && block.duration >= SLOW_MS;
  const words = STATE_WORDS[block.status];

  return (
    <section
      className={`output-card status-${block.status} ${showLine ? "is-standalone" : ""} ${quiet ? "is-quiet" : ""}`}
      aria-label={`Result of ${label.toLowerCase()}`}
      title={done && !quiet ? `${label}, took ${seconds(block.duration)}` : undefined}
      {...link}
    >
      {showLine && (
        <div className="cell-in">
          <button type="button" className="cell-line" onClick={() => editor.goToLine(block.file, line)}>
            Go to {label.toLowerCase()}
          </button>
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
            {words && <span className="output-state">{words}</span>}
            {collapsed && <span className="output-state muted">Result hidden</span>}
            {slow && <span className="output-meta">{seconds(block.duration)}</span>}
          </header>
        )}
        {done && !quiet && <ResultActions blockId={blockId} block={block} />}
        {block.paused && (
          <div className="output-paused">
            <PauseIcon size={14} />
            <span>Left out of live updates because it took {seconds(block.duration)}.</span>
            <button type="button" className="button quiet" onClick={() => runBlockAgain(blockId)}>
              Run once
            </button>
          </div>
        )}
        {block.items.length > 0 && !collapsed && (
          <div className="output-body">
            {block.items.map((item, index) => (
              <Item key={index} item={item} blockId={blockId} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Run again, Copy, and Hide, as small labeled icons at the top right of the
 * result. They show while the pointer is over the result or keyboard focus
 * is inside it, so they cost nothing to look at the rest of the time and
 * are never more than one move away.
 */
function ResultActions({ blockId, block }: { blockId: string; block: Block }) {
  const hasText = block.items.some((item) => item.type !== "plot");
  return (
    <div className="result-actions" role="group" aria-label="Result actions">
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

function Item({ item, blockId }: { item: OutputItem; blockId: string }) {
  const inspector = useStore((state) => state.ui.inspector);
  switch (item.type) {
    case "stream":
      return <pre className={`output-text stream-${item.name}`}>{item.text.replace(/\n$/, "")}</pre>;
    case "value":
      return <pre className="output-text">{item.text}</pre>;
    case "plot":
      // With the Plots pane open, the full picture is already on screen
      // there, so the result shows a small copy that leads to it. Showing
      // the same large plot twice doubles what the eye has to scan.
      return (
        <button
          type="button"
          className={`output-plot ${inspector ? "is-thumb" : ""}`}
          onClick={() => showPlot(item.plot)}
          aria-label={`Plot ${item.plot + 1}, show in the Plots pane`}
        >
          <img src={`data:image/png;base64,${item.png}`} alt="" />
          {inspector && <span className="output-plot-note">Plot {item.plot + 1}, shown in Plots</span>}
        </button>
      );
    case "error":
      return <ErrorItem message={item.message} traceback={item.traceback} parsed={item.parsed ?? ""} blockId={blockId} />;
  }
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
