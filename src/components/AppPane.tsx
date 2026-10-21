// The App pane, beside Plots, Help, Packages, and Report. It appears with
// the first Shiny app run and follows the latest one: a short wait while R
// starts, the live app once it answers, and a plain explanation with the
// failing line when it will not start.
//
// The app sits beside the code rather than in a window of its own, so a
// person can change a line, save, and watch Shiny reload it in place.
// Errors inside the running app, such as a plot that fails, are
// listed above it without stopping it, since Shiny keeps the app running.
// Open in browser gives the app a full window when the pane is too small.

import { useState } from "react";
import { baseName } from "../lib/app";
import * as editor from "../lib/editor";
import { applyShinyFix, clearProblems, explainApp, explainProblem, goToAppLine, goToSpot, locateProblem, openAppInBrowser, openShare, reloadApp, runApp, runAppAction, stopApp } from "../lib/shiny";
import { useStore, type AppProblem, type ShinyAppState } from "../lib/store";
import { AppWindowIcon, RestartIcon, StopIcon, TriangleIcon } from "./Icons";
import { ShinyMap } from "./ShinyMap";

export function AppPane() {
  const run = useStore((state) => state.shinyApp);
  const check = useStore((state) => state.shinyCheck);
  const active = useStore((state) => state.active);
  const [showLog, setShowLog] = useState(false);
  const [view, setView] = useState<"app" | "map">("app");
  // The map is for the app whose code is in front, and before an app has
  // run it is all the sheet shows, beside a way to run it.
  const graph = check && (!run || check.file === run.file || check.file === active) ? check.graph : null;
  if (!run) {
    if (!check) return null;
    return (
      <section className="report-pane app-pane" aria-label="App">
        <div className="pane-toolbar">
          <span className="report-name truncate">
            <AppWindowIcon size={14} /> How {baseName(check.file)} connects
          </span>
          <button type="button" className="button small push-end" onClick={() => runApp(check.file)}>
            <AppWindowIcon size={13} /> Run app
          </button>
        </div>
        <ShinyMap graph={check.graph} />
      </section>
    );
  }
  const live = run.status !== "ended";
  // A preview of the web version says so, since it runs without R.
  const title = run.preview ? `Web version of ${baseName(run.file)}` : baseName(run.file);
  const showMap = view === "map" && graph;
  const status = run.status === "running" ? "Running" : run.status === "starting" ? "Starting" : "Stopped";
  return (
    <section className="report-pane app-pane" aria-label="App">
      {/* Two rows: which app and whether it runs, with Stop or Run again;
          then what to look at and what to do with it, each with a label. */}
      <div className="pane-toolbar">
        <span className="report-name truncate">
          <AppWindowIcon size={14} /> {title}
        </span>
        <span className={`app-status tone-${live ? (run.status === "running" ? "ok" : "busy") : "idle"}`}>
          <span className="r-dot" aria-hidden="true" /> {status}
        </span>
        {live ? (
          <button type="button" className="button small push-end" onClick={stopApp}>
            <StopIcon size={11} /> Stop
          </button>
        ) : (
          <button type="button" className="button small primary push-end" onClick={() => runApp(run.file)}>
            Run again
          </button>
        )}
      </div>
      <div className="pane-toolbar pane-actions">
        {graph && (
          <div className="view-switch" role="radiogroup" aria-label="Show">
            <button type="button" role="radio" aria-checked={view === "app"} className={view === "app" ? "is-on" : ""} onClick={() => setView("app")}>
              The app
            </button>
            <button type="button" role="radio" aria-checked={view === "map"} className={view === "map" ? "is-on" : ""} onClick={() => setView("map")}>
              How it connects
            </button>
          </div>
        )}
        {run.status === "running" && (
          <span className="report-actions push-end">
            <button type="button" className="button small quiet" onClick={reloadApp}>
              <RestartIcon size={13} /> Reload
            </button>
            <button type="button" className="button small quiet" onClick={openAppInBrowser}>
              Open in browser
            </button>
            {!run.preview && (
              <button type="button" className="button small quiet" onClick={() => openShare(run.file)}>
                Share
              </button>
            )}
          </span>
        )}
      </div>
      {showMap && <ShinyMap graph={graph} />}
      {!showMap && run.status === "starting" && <Starting run={run} />}
      {!showMap && run.status === "running" && <Running run={run} />}
      {!showMap && run.status === "ended" && <Ended run={run} />}
      {run.log.length > 0 && (
        <div className="report-log">
          <button type="button" className="button small quiet" aria-expanded={showLog} onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide what the app printed" : "Show what the app printed"}
          </button>
          {showLog && (
            <pre className="output-text" tabIndex={0} aria-label="What the app printed">
              {run.log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

/** The wait while the app's R starts and loads its packages. */
function Starting({ run }: { run: ShinyAppState }) {
  return (
    <div className="report-progress">
      <p role="status">Starting R and the app</p>
      <progress aria-label={`Starting ${baseName(run.file)}`} />
      <p className="muted">The app runs in a separate copy of R, so you can keep using the console and your objects are left alone. Save any of the app's files and it reloads here.</p>
    </div>
  );
}

/** The live app, with any errors inside it listed above. */
function Running({ run }: { run: ShinyAppState }) {
  return (
    <div className="report-done">
      {run.problems.length > 0 && <Problems problems={run.problems} />}
      {run.url && (
        // The app is a page from its own R on this computer. It runs in a
        // sandbox at its own address, so its scripts and forms work but it
        // cannot reach the app around it.
        <iframe
          key={`${run.id}-${run.reloads}`}
          className="report-frame app-frame"
          title={run.preview ? `The web version of ${baseName(run.file)}` : `The running app, ${baseName(run.file)}`}
          src={run.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        />
      )}
    </div>
  );
}

/**
 * Errors inside the running app: the latest explained, the rest counted.
 * The explanation says where the error really happened, read from the
 * stack trace Shiny prints, with the line, the function it was in, the
 * call in the app's code that led there, and the output being made, and
 * a button to go straight there.
 */
function Problems({ problems }: { problems: AppProblem[] }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const latest = problems[problems.length - 1];
  const explained = explainProblem(latest.message);
  const found = locateProblem(latest);
  const more = problems.length - 1;
  return (
    <div className="output-error app-problems" role="group" aria-label="Errors inside the app">
      <p className="error-status">
        <TriangleIcon size={14} /> {more > 0 ? `The app hit ${problems.length} errors. The latest:` : "The app hit an error"}
      </p>
      <p className="error-title">{explained.title}</p>
      {found && (
        <p className="app-problem-where">
          <strong>Where:</strong> {found.words}.
        </p>
      )}
      <p>{explained.detail}</p>
      <p className="muted">The app is still running. The part that failed shows an error in its place until the code is fixed and saved.</p>
      <div className="button-row">
        {found && (
          <button type="button" className="button primary" onClick={() => goToAppLine(found.file, found.line, found.from, found.to)}>
            Go to line {found.line + 1}
          </button>
        )}
        {found?.fix && (
          <button type="button" className="button" onClick={() => applyShinyFix(found.fix!)}>
            {found.fix.label}
          </button>
        )}
        <button type="button" className="button quiet" aria-expanded={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
          {showOriginal ? "Hide the R message" : "Show the R message"}
        </button>
        <button type="button" className="button quiet" onClick={clearProblems}>
          Dismiss
        </button>
      </div>
      {showOriginal && (
        <pre className="output-text error-original">
          {problems.map((problem) => [problem.message, ...problem.frames.map((frame) => `  ${frame.call}${frame.file ? ` [${frame.file}#${frame.line}]` : ""}`)].join("\n")).join("\n\n")}
        </pre>
      )}
    </div>
  );
}

/** Why the app is no longer running, with the failing line when known. */
function Ended({ run }: { run: ShinyAppState }) {
  const [showOriginal, setShowOriginal] = useState(false);
  if (!run.failure) {
    return (
      <div className="report-file">
        <AppWindowIcon size={28} />
        <p>
          <strong>{baseName(run.file)}</strong> closed itself.
        </p>
        <p className="muted">Its code called stopApp(), which ends the app.</p>
      </div>
    );
  }
  const explained = explainApp(run.failure);
  const where = explained.where;
  const line = where ? editor.getText(where.file).split("\n")[where.line] ?? "" : "";
  const stopped = run.failure.kind === "stopped";
  return (
    <div className={`output-error report-problem ${stopped ? "is-stopped" : ""}`}>
      {!stopped && (
        <p className="error-status">
          <TriangleIcon size={14} /> {baseName(run.file)} did not start
        </p>
      )}
      <p className="error-title">{explained.title}</p>
      <p>{explained.detail}</p>
      {where && line && (
        <figure className="error-where">
          <figcaption>{`Where it went wrong: ${baseName(where.file)}, line ${where.line + 1}`}</figcaption>
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
          <button type="button" className="button primary" onClick={() => explained.action && runAppAction(explained.action)}>
            {explained.action.label}
          </button>
        )}
        {where && line && (
          <button type="button" className="button quiet" onClick={() => goToSpot(where)}>
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
