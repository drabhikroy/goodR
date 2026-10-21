// The script: the editor, the bar that says which section the cursor is
// in, and the banners that say when R or a package needs attention.

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { dismissMissing, goToLine, installPackages, lastRanLine, newFile, restartAndRunTo, restartR } from "../lib/app";
import * as editor from "../lib/editor";
import { applyShinyFix, goToAppLine } from "../lib/shiny";
import { checkFromScratch, dismissCheck, goToCheckLine, stopCheck } from "../lib/resultsTools";
import { isStudentCopy, readExercises } from "../lib/exercises";
import { getState, useStore } from "../lib/store";
import { AlertIcon, CheckIcon, ChevronIcon, TriangleIcon, WarnIcon } from "./Icons";
import { OutputCard } from "./OutputCard";

// Output cards inside the editor are separate React roots, mounted into the
// containers CodeMirror creates for them.
editor.setBlockRenderer((container, blockId) => {
  const root = createRoot(container);
  root.render(<OutputCard blockId={blockId} />);
  return () => setTimeout(() => root.unmount(), 0);
});

export function EditorPane() {
  const layout = useStore((state) => state.settings.outputLayout);
  const empty = useStore((state) => !state.tabs.some((tab) => tab.kind !== "data"));
  return (
    <main className="editor-pane" aria-label="Editor">
      <RStatusBanner />
      <PackageBanner />
      <ShinyBanner />
      <FreshBanner />
      <ExercisesBar />
      <div className={`editor-area layout-${layout}`}>
        <div className="editor-host-wrap">
          <EditorHost />
          {empty && <EmptyEditor />}
        </div>
      </div>
    </main>
  );
}

/**
 * Where the cursor is in a long script, and a way to jump elsewhere. It
 * sits in the document bar after the file's folder, reading as the next
 * step of a path: folder, then section. It appears only when the script
 * has two sections or more, since with one there is nowhere to jump.
 */
export function SectionBar() {
  const outline = useStore((state) => state.outline);
  const line = useStore((state) => state.cursorLine);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (outline.length < 2) return null;
  const here = [...outline].reverse().find((item) => item.line <= line);
  return (
    <div className="section-bar" ref={box}>
      <button type="button" className="section-button" aria-haspopup="menu" aria-expanded={open} title="Jump to another section of this script" aria-label={`${here ? here.label : "Top of the script"}, jump to another section`} onClick={() => setOpen(!open)}>
        <span className="section-step" aria-hidden="true">
          <ChevronIcon size={12} />
        </span>
        <span className="section-current">{here ? here.label : "Top of the script"}</span>
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <div role="menu" aria-label="Sections" className="popover section-menu">
          {outline.map((item, index) => (
            <button
              key={`${item.line}-${item.label}`}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              className={item === here ? "is-here" : ""}
              style={{ paddingLeft: `${0.7 + Math.max(0, item.level - 1) * 0.9}rem` }}
              onClick={() => {
                setOpen(false);
                goToLine(item.line);
              }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorHost() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const unmount = editor.mountEditor(host.current);
    const { active } = getState();
    if (active) editor.showDocument(active);
    return unmount;
  }, []);
  return <div ref={host} className="editor-host" />;
}

/** What the editor shows inside a project with no script open yet. */
function EmptyEditor() {
  return (
    <div className="editor-empty">
      <p>Choose a script from the sidebar, or start a new one.</p>
      <button type="button" className="button primary" onClick={newFile}>
        New script
      </button>
    </div>
  );
}

function RStatusBanner() {
  const status = useStore((state) => state.r.status);
  const message = useStore((state) => state.r.message);
  const log = useStore((state) => state.r.log);
  // After R stops, the objects the work made are gone. Running the script
  // again up to where it had got brings them back in one press.
  const upTo = useStore((state) => (state.r.status === "stopped" ? lastRanLine(state.active) : 0));
  if (status !== "stopped" && status !== "failed") return null;
  return (
    <div className="banner tone-danger" role="alert">
      <TriangleIcon size={16} />
      <div className="banner-text">
        <strong>{status === "failed" ? "R could not start." : message}</strong> Your files are safe.
        {(log || (status === "failed" && message)) && (
          <details>
            <summary>Details</summary>
            <pre>{status === "failed" ? message : log}</pre>
          </details>
        )}
      </div>
      {upTo > 0 ? (
        <>
          <button type="button" className="button primary" onClick={() => restartAndRunTo(upTo)}>
            Restart and run to line {upTo}
          </button>
          <button type="button" className="button" onClick={restartR}>
            Restart R
          </button>
        </>
      ) : (
        <button type="button" className="button primary" onClick={restartR}>
          Restart R
        </button>
      )}
    </div>
  );
}

/**
 * Likely mistakes in the Shiny app in front, read from its code as it is
 * written: each one at its line, in a sentence, with Go to line and a fix
 * where one is clear. It folds to its count, and opens by itself when a
 * new kind of problem appears.
 */
function ShinyBanner() {
  const check = useStore((state) => state.shinyCheck);
  const active = useStore((state) => state.active);
  const [open, setOpen] = useState(true);
  const findings = check && active && (check.file === active || check.findings.some((item) => item.file === active)) ? check.findings : [];
  if (!findings.length) return null;
  const several = new Set(findings.map((item) => item.file)).size > 1;
  return (
    <div className="banner tone-warn shiny-check" role="region" aria-label="Likely problems in this app">
      <AlertIcon size={16} />
      <div className="banner-text">
        <button type="button" className="shiny-check-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong>{findings.length === 1 ? "1 likely problem in this app" : `${findings.length} likely problems in this app`}</strong>
          <span className="muted"> found by reading the code, before it runs</span>
          <ChevronIcon size={12} open={open} />
        </button>
        {open && (
          <ul className="shiny-check-list">
            {findings.map((item) => (
              <li key={`${item.file}:${item.line}:${item.from}:${item.title}`}>
                <p className="shiny-check-title">
                  <span className="shiny-check-line">
                    {several ? `${item.file.split(/[\\/]/).pop()}, line ${item.line + 1}` : `Line ${item.line + 1}`}
                  </span>{" "}
                  {item.title}
                </p>
                <p className="shiny-check-detail">{item.detail}</p>
                <div className="button-row">
                  <button type="button" className="button small" onClick={() => goToAppLine(item.file, item.line, item.from, item.to)}>
                    Go to line {item.line + 1}
                  </button>
                  {item.fix && (
                    <button type="button" className="button small primary" onClick={() => applyShinyFix(item.fix!)}>
                      {item.fix.label}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * What Check it runs from scratch found, for the file in front: under
 * way, ran to the end, or the line that failed in a new R and why. A
 * failure there usually means the script leans on something done by hand,
 * so the banner says so in those words.
 */
function FreshBanner() {
  const check = useStore((state) => state.freshCheck);
  const active = useStore((state) => state.active);
  if (!check || check.file !== active) return null;
  if (check.status === "running") {
    return (
      <div className="banner tone-info" role="status">
        <span className="banner-text">Running this script in a new R, from the first line to the last.</span>
        <button type="button" className="button quiet" onClick={stopCheck}>
          Stop
        </button>
      </div>
    );
  }
  if (check.status === "ok") {
    return (
      <div className="banner tone-ok" role="status">
        <CheckIcon size={16} />
        <span className="banner-text">
          <strong>It runs from scratch.</strong> All {check.ran} {check.ran === 1 ? "statement" : "statements"} ran in a new R, so it should run the same on another computer.
        </span>
        <button type="button" className="button quiet" onClick={dismissCheck}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="banner tone-warn" role="alert">
      <WarnIcon size={16} />
      <div className="banner-text">
        <strong>{check.line === null ? "It did not run from scratch." : `In a new R, line ${check.line + 1} fails.`}</strong> {check.message}
        <p className="muted">
          It works here because of something R already has, such as an object made at the prompt, a package loaded by hand, or a line since deleted. Write that step into the script.
        </p>
      </div>
      {check.line !== null && (
        <button type="button" className="button primary" onClick={goToCheckLine}>
          Go to line {check.line + 1}
        </button>
      )}
      <button type="button" className="button" onClick={checkFromScratch}>
        Check again
      </button>
      <button type="button" className="button quiet" onClick={dismissCheck}>
        Close
      </button>
    </div>
  );
}

/**
 * In a student's copy of exercises: how many are done, and the next one to
 * do, with a way to go to it. It reads the exercises from the script each
 * time the file in front or the progress changes.
 */
function ExercisesBar() {
  const active = useStore((state) => state.active);
  const progress = useStore((state) => (state.active ? state.exerciseProgress[state.active] : undefined));
  if (!active || active.startsWith("data:")) return null;
  const text = editor.getText(active);
  if (!isStudentCopy(text)) return null;
  const exercises = readExercises(text);
  const done = progress?.done ?? [];
  const next = exercises.find((exercise) => !done.includes(exercise.number));
  return (
    <div className="banner tone-info exercises-bar" role="status">
      <span className="banner-text">
        <strong>
          {done.length} of {exercises.length} exercises done.
        </strong>{" "}
        {next ? `Next, exercise ${next.number}: ${next.task}` : "That is all of them."}
      </span>
      {next && (
        <button type="button" className="button" onClick={() => editor.goToLine(active, next.from)}>
          Go to exercise {next.number}
        </button>
      )}
    </div>
  );
}

function PackageBanner() {
  const missing = useStore((state) => state.missing);
  const status = useStore((state) => state.r.status);
  if (!missing.length || status === "starting") return null;
  const names = missing.map((item) => item.name);
  const first = missing[0];
  return (
    <div className="banner tone-warn" role="status">
      <WarnIcon size={16} />
      <span className="banner-text">
        {names.length === 1 ? (
          <>
            Line {first.line} uses <code>{first.name}</code>, which is not installed yet.
          </>
        ) : (
          <>
            This script uses {names.length} packages that are not installed yet: <code>{names.join(", ")}</code>.
          </>
        )}
      </span>
      <button type="button" className="button primary" onClick={() => installPackages(names)}>
        {names.length === 1 ? `Install ${first.name}` : "Install them"}
      </button>
      <button type="button" className="button quiet" onClick={dismissMissing}>
        Not now
      </button>
    </div>
  );
}
