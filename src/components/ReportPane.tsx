// The Report pane, beside Plots, Help, and Packages. It appears with the
// first render and follows the latest one: progress while it runs, the
// finished report while it is ready, and a plain explanation with the
// failing line when it is not.
//
// The preview sits beside the code rather than in a tab over it, so a
// person can change a line, render again, and see the result without
// losing their place. Open hands the file to the system's own app for a
// full size view, and Word files always open there.

import { useState } from "react";
import { baseName, openFile } from "../lib/app";
import * as editor from "../lib/editor";
import { explainRender, openOutput, previewUrl, renderReport, runRenderAction, stopRender } from "../lib/report";
import { useStore, type ReportState } from "../lib/store";
import { FolderIcon, ReportIcon, StopIcon, TriangleIcon } from "./Icons";

const FORMAT_NAMES: Record<string, string> = { html: "HTML", docx: "Word", pdf: "PDF" };

/** The format of a rendered file, from its extension. */
function formatOf(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function ReportPane() {
  const report = useStore((state) => state.report);
  const platform = useStore((state) => state.info?.platform);
  const [showLog, setShowLog] = useState(false);
  if (!report) return null;
  const running = report.status === "running";
  return (
    <section className="report-pane" aria-label="Report">
      <div className="pane-toolbar">
        <span className="report-name truncate">
          <ReportIcon size={14} /> {baseName(report.file)}
        </span>
        {running ? (
          <button type="button" className="button small push-end" onClick={stopRender}>
            <StopIcon size={11} /> Stop
          </button>
        ) : (
          <button type="button" className="button small quiet push-end" onClick={() => renderReport(report.target, report.file)}>
            Render again
          </button>
        )}
      </div>
      {running && <Progress report={report} />}
      {report.status === "done" && <Finished report={report} platform={platform} />}
      {(report.status === "failed" || report.status === "stopped") && report.failure && <Problem report={report} />}
      {report.log.length > 0 && (
        <div className="report-log">
          <button type="button" className="button small quiet" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide the render log" : "Show the render log"}
          </button>
          {showLog && (
            <pre className="output-text" tabIndex={0} aria-label="Render log">
              {report.log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

/** How far the render has got, in parts as knitr counts them. */
function Progress({ report }: { report: ReportState }) {
  const progress = report.progress;
  const words = progress
    ? `Part ${progress.done} of ${progress.total}${progress.label && !/^unnamed-chunk/.test(progress.label) ? `, the chunk named ${progress.label}` : ""}`
    : "Starting R and reading the document";
  return (
    <div className="report-progress">
      <p role="status">{words}</p>
      <progress max={progress?.total ?? 1} value={progress ? progress.done : undefined} aria-label={`Rendering ${baseName(report.file)}`} />
      <p className="muted">Rendering runs in its own R, so the console stays free and your objects are not changed.</p>
    </div>
  );
}

/** The finished report: a preview of HTML or PDF, and Open for the rest. */
function Finished({ report, platform }: { report: ReportState; platform?: string }) {
  const outputs = report.outputs;
  const preferred = outputs.find((path) => formatOf(path) === "html") ?? outputs.find((path) => formatOf(path) === "pdf") ?? outputs[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = chosen && outputs.includes(chosen) ? chosen : preferred;
  if (!shown) {
    return <p className="pane-empty muted">The render finished but did not name a file. The render log below shows what it printed.</p>;
  }
  const format = formatOf(shown);
  const seconds = Math.max(1, Math.round((report.finished - report.started) / 1000));
  const reveal = platform === "macos" ? "Show in Finder" : "Show in folder";
  return (
    <div className="report-done">
      <div className="report-bar">
        {outputs.length > 1 && (
          <div className="report-formats" role="group" aria-label="Rendered files">
            {outputs.map((path) => (
              <button key={path} type="button" className={`chip ${path === shown ? "is-on" : ""}`} aria-pressed={path === shown} onClick={() => setChosen(path)}>
                {FORMAT_NAMES[formatOf(path)] ?? formatOf(path).toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <span className="muted truncate report-when" title={`${baseName(shown)}, rendered in ${seconds} ${seconds === 1 ? "second" : "seconds"}`}>
          {baseName(shown)}, rendered in {seconds} {seconds === 1 ? "second" : "seconds"}
        </span>
        <span className="report-actions">
          <button type="button" className="button small" onClick={() => openOutput(shown)}>
            {format === "html" ? "Open in browser" : "Open"}
          </button>
          <button type="button" className="button small quiet" aria-label={reveal} title={reveal} onClick={() => openOutput(shown, true)}>
            <FolderIcon size={14} />
          </button>
        </span>
      </div>
      {format === "html" || format === "pdf" ? (
        // The report runs in a sandbox: its scripts work, such as Quarto's
        // tabs and code folding, but it cannot reach the app.
        <iframe
          key={`${shown}-${report.finished}`}
          className="report-frame"
          title={`Preview of ${baseName(shown)}`}
          src={previewUrl(shown)}
          sandbox={format === "html" ? "allow-scripts allow-popups allow-popups-to-escape-sandbox" : undefined}
        />
      ) : (
        <div className="report-file">
          <ReportIcon size={28} />
          <p>
            <strong>{baseName(shown)}</strong> is ready.
          </p>
          <p className="muted">{format === "docx" ? "Word documents open in Word, Pages, or LibreOffice." : "This kind of file opens in its own app."}</p>
          <button type="button" className="button primary" onClick={() => openOutput(shown)}>
            Open {baseName(shown)}
          </button>
        </div>
      )}
    </div>
  );
}

/** Why the render stopped, with the failing line and one thing to try. */
function Problem({ report }: { report: ReportState }) {
  const [showOriginal, setShowOriginal] = useState(false);
  if (!report.failure) return null;
  const explained = explainRender(report.failure, report.file);
  const where = explained.where;
  const line = where ? editor.getText(report.file).split("\n")[where.line] ?? "" : "";
  const stopped = report.failure.kind === "stopped";
  return (
    <div className={`output-error report-problem ${stopped ? "is-stopped" : ""}`}>
      {!stopped && (
        <p className="error-status">
          <TriangleIcon size={14} /> {baseName(report.file)} did not render
        </p>
      )}
      <p className="error-title">{explained.title}</p>
      <p>{explained.detail}</p>
      {where && line && (
        <figure className="error-where">
          <figcaption>{`Where it went wrong: ${explained.chunk ?? "the report"}, line ${where.line + 1}`}</figcaption>
          <pre>
            <code>
              {line.slice(0, where.from)}
              <mark>{line.slice(where.from, where.from + where.text.length)}</mark>
              {line.slice(where.from + where.text.length)}
            </code>
            {"\n"}
            <span className="error-carets" aria-hidden="true">
              {" ".repeat(where.from)}
              {"^".repeat(Math.max(1, where.text.length))}
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
        {explained.action && (
          <button type="button" className="button primary" onClick={() => explained.action && runRenderAction(explained.action)}>
            {explained.action.label}
          </button>
        )}
        {where && line && (
          <button
            type="button"
            className="button quiet"
            onClick={async () => {
              await openFile(report.file);
              editor.selectSpan(report.file, where.line, where.text, where.from);
            }}
          >
            Go to the spot
          </button>
        )}
        {explained.original && (
          <button type="button" className="button quiet" aria-expanded={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? "Hide the R message" : "Show the R message"}
          </button>
        )}
      </div>
      {showOriginal && explained.original && <pre className="output-text error-original">{explained.original}</pre>}
    </div>
  );
}
