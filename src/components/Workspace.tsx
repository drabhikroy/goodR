// The workspace: sidebar (for projects), title bar, the script with its
// document bar, and the canvas. The title bar holds window-level things
// (projects, tabs, search); the document bar holds what acts on the file
// below it. Everything else is in the menus and the command palette.

import { activateTab, baseName, chooseAndOpenProject, chunkWord, openRecentProject, closeTab, folderOf, newFile, openDialog, runChunk, runDefault, runFile, runLine, runScopeFor, sessionLabel, setOutputLayout, setRunScope, shortPath, showSessionTab, showStartScreen, stop, toggleFocus, toggleLive, undoLastRun, togglePalette, togglePane, updateSettings } from "../lib/app";
import { keyLabel } from "../lib/commands";
import * as editor from "../lib/editor";
import { isReport, renderReport, stopRender } from "../lib/report";
import { isShinyApp, openShare, runApp, stopApp } from "../lib/shiny";
import { useStore } from "../lib/store";
import { useEffect } from "react";
import type { OutputLayout, ResultStyle, RunScope } from "../lib/types";
import { Canvas, elapsedWords, PlotViewer, useElapsed } from "./Canvas";
import { Composer } from "./Composer";
import { DataViewer } from "./DataViewer";
import { EditorPane, SectionBar } from "./EditorPane";
import { AppWindowIcon, HistoryIcon, CheckIcon, ChevronIcon, CloseIcon, HomeIcon, PanelIcon, PlayIcon, SearchIcon, PlusIcon, ReportIcon, StopIcon, TableIcon, UndoIcon } from "./Icons";
import { Sidebar } from "./Sidebar";
import { Popover, usePopover } from "./Popover";
import { openFileHistory } from "../lib/fileHistory";

export function Workspace() {
  const focus = useStore((state) => state.ui.focus);
  const sidebar = useStore((state) => state.ui.sidebar && state.project !== null && !state.ui.focus);
  const active = useStore((state) => state.active);
  const viewingData = Boolean(active?.startsWith("data:"));
  // Focus mode hides the rest with styles rather than removing it, so the
  // prompt keeps what was typed and the timeline its place.
  return (
    <div className={`workspace ${focus ? "is-focus" : ""}`}>
      {sidebar && <Sidebar />}
      <div className="workspace-main">
        <TitleBar besideSidebar={sidebar} />
        <div className="workspace-body">
          <div className="center">
            <div className="sheet">
              {active && !viewingData && <DocumentBar />}
              {/* The editor stays mounted while a data tab is shown, so each
                  script keeps its scroll position and undo history. */}
              <div className={`center-swap ${viewingData ? "is-data" : ""}`}>
                <EditorPane />
                {viewingData && active && <DataViewer key={active} name={active.slice(5)} />}
              </div>
            </div>
            <Composer />
          </div>
          <Canvas />
        </div>
      </div>
      <PlotViewer />
    </div>
  );
}

/**
 * The bar across the top of the document: where the file is and which
 * section the cursor is in, on the left, and what acts on this file on
 * the right, ending with Run. Render and Run app appear only for files
 * they apply to, so the bar never offers what cannot be done.
 */
function DocumentBar() {
  const active = useStore((state) => state.active);
  const untitled = Boolean(active?.startsWith("untitled:"));
  return (
    <div className="doc-bar">
      <div className="doc-where">
        <span className="doc-folder truncate" title={active && !untitled ? shortPath(active) : "Not saved yet"}>
          {active && !untitled ? shortPath(folderOf(active)) : "Not saved yet"}
        </span>
        <SectionBar />
        {active && !untitled && (
          <button type="button" className="icon-button doc-history" aria-label="Earlier versions of this file" title="Earlier versions of this file" onClick={openFileHistory}>
            <HistoryIcon size={15} />
          </button>
        )}
      </div>
      <div className="doc-actions">
        <ResultsMenu />
        <RenderButton />
        <RunAppButton />
        <RunButton />
      </div>
    </div>
  );
}

function TitleBar({ besideSidebar }: { besideSidebar: boolean }) {
  const platform = useStore((state) => state.info?.platform);
  return (
    // The bar doubles as the window's title bar on macOS, so its empty
    // space drags the window, as in Safari and Xcode. Beside the sidebar,
    // the window buttons sit in the sidebar instead.
    <header className={`title-bar ${platform === "macos" && !besideSidebar ? "has-traffic-lights" : ""}`} data-tauri-drag-region>
      <button type="button" className="icon-button home-button" aria-label="Show the start screen" title={`Show the start screen, ${keyLabel("⇧⌘H")}`} onClick={showStartScreen}>
        <HomeIcon size={16} />
      </button>
      <ProjectSwitcher />
      <Tabs />
      <div className="title-bar-spacer" data-tauri-drag-region />
      <div className="title-bar-end">
        <LeaveFocus />
        <SearchField />
        <RAnnouncer />
        <PanelToggle />
      </div>
    </header>
  );
}

/** One field for everything that is looked for rather than worked on: R
 * help on a function, any command, and the app's own guide. It opens the
 * command palette, which also looks names up in R's help. */
function SearchField() {
  return (
    <button type="button" className="search-field" onClick={() => togglePalette()} aria-label="Search help and commands" aria-keyshortcuts="Meta+K">
      <SearchIcon size={14} />
      <span>Search</span>
      <kbd>{keyLabel("⌘K")}</kbd>
    </button>
  );
}

/** While focus mode is on, the way out stays in view, so it is never a
 * mode someone is stuck in. */
function LeaveFocus() {
  const focus = useStore((state) => state.ui.focus);
  if (!focus) return null;
  return (
    <button type="button" className="button small leave-focus" onClick={toggleFocus} title={`Leave focus mode, ${keyLabel("⌥⌘F")}`}>
      Leave focus
    </button>
  );
}

/** Shows or hides the canvas, giving the script the whole width. */
function PanelToggle() {
  const open = useStore((state) => state.ui.inspector);
  return (
    <button type="button" className={`icon-button panel-toggle ${open ? "is-on" : ""}`} aria-label="Show the canvas" aria-pressed={open} title={`${open ? "Hide" : "Show"} the canvas, ${keyLabel("⌥⌘0")}`} onClick={() => togglePane("inspector")}>
      <PanelIcon size={17} />
    </button>
  );
}

function Tabs() {
  const tabs = useStore((state) => state.tabs);
  const active = useStore((state) => state.active);
  // Two scripts can share a name, such as analysis.R in two projects. Those
  // tabs also show their folder, so the names never look identical.
  const shared = new Set(tabs.map((tab) => tab.name).filter((name, index, names) => names.indexOf(name) !== index));
  return (
    <div className="tab-strip" data-tauri-drag-region>
      {/* The tab list holds only tabs, as screen readers expect. Each close
          button is for pointers. Keyboard users close a tab with Command W
          or File, Close Tab, so the button stays out of the Tab order. */}
      <div role="tablist" aria-label="Open scripts" className="tabs">
        {tabs.map((tab) => (
          <div key={tab.path} role="presentation" className={`tab ${tab.path === active ? "is-active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.path === active}
              className="tab-button"
              onClick={() => activateTab(tab.path)}
              title={tab.untitled ? "Not saved yet" : shortPath(tab.path)}
            >
              {tab.kind === "data" && <TableIcon size={14} />}
              <span className="tab-name">{tab.name}</span>
              {shared.has(tab.name) && !tab.untitled && <span className="tab-folder">{baseName(folderOf(tab.path))}</span>}
              {tab.dirty && (
                <span className="tab-dirty" title="Edited, not saved yet">
                  <span className="visually-hidden">edited</span>
                </span>
              )}
            </button>
            <button type="button" className="tab-close" tabIndex={-1} aria-hidden="true" title={`Close ${tab.name}`} onClick={() => closeTab(tab.path)}>
              <CloseIcon size={11} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="icon-button new-tab" aria-label="New script" title={`New script, ${keyLabel("⌘N")}`} onClick={newFile}>
        <PlusIcon size={14} />
      </button>
    </div>
  );
}

/**
 * What is open, by project, as a menu to switch between them: each
 * project, script on its own, or untitled work with a tab open, whether
 * its R is busy, and the projects opened recently. The name of the one on
 * show is the button's label, so it also says where the tabs belong.
 */
function ProjectSwitcher() {
  const active = useStore((state) => state.activeSession);
  const status = useStore((state) => state.r.status);
  const sessions = useStore((state) => state.sessions);
  const tabs = useStore((state) => state.tabs);
  const recent = useStore((state) => state.settings.recentProjects);
  const { open, setOpen, box } = usePopover();
  const openKeys = Object.keys(sessions).filter((key) => key === active || tabs.some((tab) => tab.session === key));
  const openRoots = openKeys.map((key) => sessions[key].project?.root).filter(Boolean);
  const closed = recent.filter((item) => !openRoots.some((root) => item.path.startsWith(`${root}/`))).slice(0, 5);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="popover-anchor project-switcher" ref={box}>
      <button type="button" className="project-switch" aria-haspopup="menu" aria-expanded={open} title="Switch to another open project or script" onClick={() => setOpen(!open)}>
        {status !== "ready" && status !== "none" && <span className={`r-dot tone-${status === "busy" || status === "starting" ? "busy" : "danger"}`} title={R_WORDS[status]} aria-hidden="true" />}
        <span className="truncate">{sessionLabel(active)}</span>
        {openKeys.length > 1 && (
          <>
            <span className="project-count" aria-hidden="true">
              {openKeys.length}
            </span>
            <span className="visually-hidden">, {openKeys.length} open</span>
          </>
        )}
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <Popover label="Projects" className="project-popover">
          <p className="popover-heading">Open now</p>
          {openKeys.map((key) => (
            <button key={key} type="button" role="menuitemradio" aria-checked={key === active} autoFocus={key === active} onClick={() => pick(() => showSessionTab(key))}>
              <span className="menu-check" aria-hidden="true">
                {key === active && <CheckIcon size={13} />}
              </span>
              <span className="truncate">{sessionLabel(key)}</span>
              <span className="menu-hint">{sessions[key].r.status === "busy" ? "Running" : `${tabs.filter((tab) => tab.session === key).length} open`}</span>
            </button>
          ))}
          {closed.length > 0 && <p className="popover-heading">Recent projects</p>}
          {closed.map((item) => (
            <button key={item.path} type="button" role="menuitem" title={shortPath(item.path)} onClick={() => pick(() => openRecentProject(item.path))}>
              <span className="menu-check" aria-hidden="true" />
              <span className="truncate">{baseName(folderOf(item.path))}</span>
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={() => pick(chooseAndOpenProject)}>
            <span className="menu-check" aria-hidden="true" />
            Open a project
          </button>
          <button type="button" role="menuitem" onClick={() => pick(() => openDialog("newProject"))}>
            <span className="menu-check" aria-hidden="true" />
            New project
          </button>
        </Popover>
      )}
    </div>
  );
}

// R's state in words, for screen readers only. What a sighted person
// needs is already on screen: Run turns into Stop while R works, a bar says
// what is running, and a banner over the script says when R has stopped or
// could not start, with the way to start it again.
const R_WORDS: Record<string, string> = {
  none: "R not started",
  starting: "Starting R",
  ready: "R is ready",
  busy: "R is running",
  stopped: "R stopped",
  failed: "R could not start",
  missing: "R is not installed",
};

function RAnnouncer() {
  const status = useStore((state) => state.r.status);
  return (
    <span className="visually-hidden" role="status">
      {R_WORDS[status]}
    </span>
  );
}

const LAYOUTS: { value: OutputLayout; label: string; keys: string }[] = [
  { value: "canvas", label: "In the canvas", keys: "⌥⌘1" },
  { value: "inline", label: "Under each line", keys: "⌥⌘2" },
];

const STYLES: { value: ResultStyle; label: string; hint: string }[] = [
  { value: "cards", label: "Cards", hint: "Code tinted, each result in its own well" },
  { value: "plain", label: "Plain text", hint: "Results printed under the code, nothing around them" },
];

/**
 * Where results appear, and whether they update as you type, in one menu.
 * These change rarely, so they sit behind one labeled button instead of
 * four controls that are always on show.
 */
function ResultsMenu() {
  const layout = useStore((state) => state.settings.outputLayout);
  const style = useStore((state) => state.settings.resultStyle);
  const live = useStore((state) => state.live);
  const { open, setOpen, box } = usePopover();
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="popover-anchor" ref={box} data-guide="results">
      <button type="button" className="button quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Results
        {live && <span className="badge">Live</span>}
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <Popover label="Results">
          <p className="popover-label">Show results</p>
          {LAYOUTS.map((item, index) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={layout === item.value}
              autoFocus={index === 0}
              onClick={() => pick(() => setOutputLayout(item.value))}
            >
              <span className="menu-check" aria-hidden="true">{layout === item.value ? "✓" : ""}</span>
              <span>{item.label}</span>
              <kbd>{keyLabel(item.keys)}</kbd>
            </button>
          ))}
          {/* The look applies to results in either place. */}
          <hr />
          <p className="popover-label">Look</p>
          {STYLES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={style === item.value}
              onClick={() => pick(() => updateSettings({ resultStyle: item.value }))}
            >
              <span className="menu-check" aria-hidden="true">{style === item.value ? "✓" : ""}</span>
              <span>
                {item.label}
                <span className="menu-hint">{item.hint}</span>
              </span>
            </button>
          ))}
          <hr />
          <button type="button" role="menuitemcheckbox" aria-checked={live} onClick={() => pick(toggleLive)}>
            <span className="menu-check" aria-hidden="true">{live ? "✓" : ""}</span>
            <span>
              Update as you type
              <span className="menu-hint">Reruns the line you are editing when you pause</span>
            </span>
            <kbd>{keyLabel("⌥⌘L")}</kbd>
          </button>
        </Popover>
      )}
    </div>
  );
}

const RENDER_AS: { target: "html" | "word" | "pdf"; label: string; hint: string }[] = [
  { target: "html", label: "Render as HTML", hint: "A web page, previewed beside the code" },
  { target: "word", label: "Render as Word", hint: "A .docx file to edit or send" },
  { target: "pdf", label: "Render as PDF", hint: "" },
];

/**
 * Render, shown only while a Quarto or R Markdown file is in the editor.
 * The button renders the report as its header says. The arrow beside it
 * offers the other formats. While a report renders, it becomes Stop.
 */
function RenderButton() {
  const active = useStore((state) => state.active);
  const rendering = useStore((state) => state.report?.status === "running");
  // How a PDF is made follows the choice in Settings, under Reports.
  const engine = useStore((state) => state.settings.pdfEngine);
  const pdfHint = engine === "latex" ? "Made with LaTeX" : engine === "typst" ? "Made with Typst, so no LaTeX is needed" : "Made with LaTeX when you have it, otherwise Typst";
  const { open, setOpen, box } = usePopover();
  useEffect(() => {
    if (rendering) setOpen(false);
  }, [rendering, setOpen]);
  if (!isReport(active)) return null;
  if (rendering) {
    return (
      <button type="button" className="button quiet" onClick={stopRender}>
        <StopIcon size={12} /> Stop rendering
      </button>
    );
  }
  return (
    <div className="popover-anchor split-button" ref={box}>
      <button type="button" className="button" onClick={() => renderReport()} title={`Render the report, ${keyLabel("⇧⌘K")}`}>
        <ReportIcon size={14} /> Render
      </button>
      <button type="button" className="button split-arrow" aria-label="Render in another format" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <Popover label="Render in another format">
          {RENDER_AS.map((item, index) => (
            <button key={item.target} type="button" role="menuitem" autoFocus={index === 0} onClick={() => (setOpen(false), renderReport(item.target))}>
              <span className="menu-check" aria-hidden="true" />
              <span>
                {item.label}
                <span className="menu-hint">{item.target === "pdf" ? pdfHint : item.hint}</span>
              </span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/**
 * Run app, shown only while a Shiny app is in the editor, as RStudio
 * shows it. While that app runs, it becomes Stop app. The app runs in its
 * own R, so Run line beside it keeps working on the console.
 */
function RunAppButton() {
  const active = useStore((state) => state.active);
  const running = useStore((state) => (state.shinyApp && state.shinyApp.status !== "ended" ? state.shinyApp.file : null));
  // The outline is rebuilt after each pause in typing, so reading it here
  // shows the button soon after a script gains a shinyApp() call.
  useStore((state) => state.outline);
  const { open, setOpen, box } = usePopover();
  useEffect(() => {
    if (running && running === active) setOpen(false);
  }, [running, active, setOpen]);
  if (!active || !isShinyApp(active, editor.getText(active))) return null;
  if (running === active) {
    return (
      <button type="button" className="button quiet" onClick={stopApp}>
        <StopIcon size={12} /> Stop app
      </button>
    );
  }
  return (
    <div className="popover-anchor split-button" ref={box}>
      <button type="button" className="button primary" onClick={() => runApp(active)} title="Run the app in the App pane">
        <AppWindowIcon size={14} /> Run app
      </button>
      <button type="button" className="button primary split-arrow" aria-label="More for this app" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <Popover label="More for this app">
          <button type="button" role="menuitem" autoFocus onClick={() => (setOpen(false), openShare(active))}>
            <span className="menu-check" aria-hidden="true" />
            <span>
              Share as a web page
              <span className="menu-hint">Runs in any browser, with nothing to install</span>
            </span>
          </button>
        </Popover>
      )}
    </div>
  );
}

// What each Run choice is called, and its shortcut.
const SCOPES: { scope: RunScope; keys: string }[] = [
  { scope: "line", keys: "⌘↩" },
  { scope: "chunk", keys: "⌥⌘C" },
  { scope: "file", keys: "⇧⌘↩" },
];

/** The name of a Run choice, for a file. A script's chunk is its section. */
function scopeName(scope: RunScope, path: string | null) {
  if (scope === "line") return "Run line";
  if (scope === "file") return "Run file";
  return chunkWord(path) === "chunk" ? "Run chunk" : "Run section";
}

/**
 * Run, as a split button. The main part runs the file's default (a line
 * in a script, a chunk in a document, or whatever the user picked for
 * this file); the arrow lists the other ways to run and changes that
 * default. While R works it turns into Stop.
 */
function RunButton() {
  const busy = useStore((state) => state.r.status === "busy");
  const canvasOpen = useStore((state) => state.ui.inspector);
  const elapsed = useElapsed();
  const active = useStore((state) => state.active);
  const scope = useStore((state) => runScopeFor(state.active));
  const undoable = useStore((state) => Boolean(state.undo[state.activeSession]) && state.r.status !== "busy");
  // Read so the button's look follows a script that becomes a Shiny app.
  useStore((state) => state.outline);
  const { open, setOpen, box } = usePopover();
  // A run started some other way closes the menu, so it does not open again
  // by itself, and take focus, when the run ends.
  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy, setOpen]);
  if (busy) {
    return (
      <button type="button" className="button run-button is-stop" onClick={stop} title={`Stop, ${keyLabel("⌘.")}`}>
        <StopIcon size={12} /> Stop
        {/* With the canvas hidden, its progress bar is too, so the time
            so far shows here instead. */}
        {!canvasOpen && elapsed !== null && elapsed >= 1000 && <span className="run-elapsed">{elapsedWords(elapsed)}</span>}
      </button>
    );
  }
  const file = active && !active.startsWith("data:") ? active : null;
  const keys = SCOPES.find((item) => item.scope === scope)?.keys ?? "⌘↩";
  // In a Shiny app, Run app is the main action, so Run steps back; it still
  // runs single lines, such as library(shiny), for trying things out.
  const tone = file && isShinyApp(file, editor.getText(file)) ? "" : "primary";
  return (
    <div className="popover-anchor split-button run-split" ref={box}>
      <button type="button" className={`button ${tone} run-button`} onClick={runDefault} title={`${scopeName(scope, file)}, ${keyLabel(keys)}`}>
        <PlayIcon size={12} /> {scopeName(scope, file)}
      </button>
      <button type="button" className={`button ${tone} split-arrow`} aria-label="More ways to run" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon size={12} open />
      </button>
      {open && (
        <Popover label="More ways to run" className="run-menu">
          {SCOPES.map((item, index) => (
            <button
              key={item.scope}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              onClick={() => {
                setOpen(false);
                if (item.scope === "file") runFile();
                else if (item.scope === "chunk") runChunk();
                else runLine();
              }}
            >
              <PlayIcon size={11} />
              <span>{scopeName(item.scope, file)}</span>
              <kbd>{keyLabel(item.keys)}</kbd>
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => (setOpen(false), runFile(true))}>
            <span className="menu-check" aria-hidden="true" />
            <span>Run to the cursor</span>
            <kbd>{keyLabel("⌥⌘B")}</kbd>
          </button>
          {/* Kept in place when there is nothing to undo, so the menu
              never shifts under the pointer. */}
          <button type="button" role="menuitem" aria-disabled={!undoable} disabled={!undoable} onClick={() => (setOpen(false), undoLastRun())}>
            <UndoIcon size={12} />
            <span>Undo the last run</span>
            <kbd>{keyLabel("⌥⌘Z")}</kbd>
          </button>
          {file && (
            <>
              <hr />
              <p className="popover-heading" id="run-default-heading">
                The Run button, for {baseName(file)}
              </p>
              <div role="group" aria-labelledby="run-default-heading">
                {SCOPES.map((item) => (
                  <button key={item.scope} type="button" role="menuitemradio" aria-checked={scope === item.scope} onClick={() => (setOpen(false), setRunScope(file, item.scope))}>
                    <span className="menu-check" aria-hidden="true">
                      {scope === item.scope && <CheckIcon size={12} />}
                    </span>
                    <span>{scopeName(item.scope, file)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}
