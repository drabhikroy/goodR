// The workspace: the project sidebar when a project is open, one title
// bar holding the open tabs and the few controls used all the time, the
// document with its cells, the console, and the inspector. Everything else
// lives in the menu bar and the command palette, so the window shows the
// work rather than the tools.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { activateTab, baseName, closeTab, folderOf, newFile, openDialog, restartR, runLine, setOutputLayout, shortPath, stop, toggleLive, updateSettings } from "../lib/app";
import { keyLabel } from "../lib/commands";
import { isReport, renderReport, stopRender } from "../lib/report";
import { useStore } from "../lib/store";
import type { OutputLayout, ResultStyle } from "../lib/types";
import { Console } from "./Console";
import { DataViewer } from "./DataViewer";
import { EditorPane, SectionBar } from "./EditorPane";
import { ChevronIcon, CloseIcon, PlayIcon, PlusIcon, ReportIcon, StopIcon, TableIcon } from "./Icons";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";

export function Workspace() {
  const inspector = useStore((state) => state.ui.inspector);
  const sidebar = useStore((state) => state.ui.sidebar && state.project !== null);
  const active = useStore((state) => state.active);
  const viewingData = Boolean(active?.startsWith("data:"));
  return (
    <div className="workspace">
      {sidebar && <Sidebar />}
      <div className="workspace-main">
        <TitleBar besideSidebar={sidebar} />
        <div className="workspace-body">
          <div className="center">
            {/* The editor stays mounted while a data tab is shown, so each
                script keeps its scroll position and undo history. */}
            <div className={`center-swap ${viewingData ? "is-data" : ""}`}>
              <EditorPane />
              {viewingData && active && <DataViewer key={active} name={active.slice(5)} />}
            </div>
            <Console />
          </div>
          {inspector && <Inspector />}
        </div>
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
      <Tabs />
      <SectionBar />
      <div className="title-bar-spacer" data-tauri-drag-region />
      <div className="title-bar-end">
        <RStatus />
        <ResultsMenu />
        <RenderButton />
        <RunButton />
      </div>
    </header>
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
              {tab.dirty && <span className="tab-dirty">edited</span>}
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

/** Closes a popover on Escape or a click outside it, returning focus to
 * the button that opened it. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      const outside = event instanceof MouseEvent && !box.current?.contains(event.target as Node);
      const escape = event instanceof KeyboardEvent && event.key === "Escape";
      if (outside || escape) {
        setOpen(false);
        if (escape) box.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, box };
}

/** Moves focus among a menu's items with the arrow keys, as native menus do. */
function menuKeys(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  items[next]?.focus();
}

function Popover({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="menu" aria-label={label} className={`popover ${className}`} onKeyDown={menuKeys}>
      {children}
    </div>
  );
}

/**
 * R's state in a few words, as a button. It opens the details that used to
 * take up room on screen all the time: the working folder, Restart R, and
 * the version in use.
 */
function RStatus() {
  const r = useStore((state) => state.r);
  const { open, setOpen, box } = usePopover();
  const words: Record<string, string> = {
    none: "R not started",
    starting: "Starting R",
    ready: `R ${r.version}`,
    busy: "Running",
    stopped: "R stopped",
    failed: "R could not start",
    missing: "R not installed",
  };
  const tone = r.status === "ready" ? "ok" : r.status === "busy" || r.status === "starting" ? "busy" : r.status === "none" ? "idle" : "danger";
  return (
    <div className="popover-anchor" ref={box}>
      <button type="button" className={`r-status tone-${tone}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="r-dot" aria-hidden="true" />
        {words[r.status]}
      </button>
      {/* Changes in R's state are announced from outside the button, since
          a live region inside it would hide the button's own name. */}
      <span className="visually-hidden" role="status">
        {words[r.status]}
      </span>
      {open && (
        <Popover label="R" className="r-popover">
          {r.workingDir && (
            <p className="popover-note">
              Working folder
              <br />
              <code>{shortPath(r.workingDir)}</code>
            </p>
          )}
          <button type="button" role="menuitem" autoFocus onClick={() => (setOpen(false), restartR())}>
            Restart R
          </button>
          <button type="button" role="menuitem" onClick={() => (setOpen(false), openDialog("chooseR"))}>
            Choose R version
          </button>
        </Popover>
      )}
    </div>
  );
}

const LAYOUTS: { value: OutputLayout; label: string; keys: string }[] = [
  { value: "inline", label: "Under each line", keys: "⌥⌘1" },
  { value: "side", label: "Beside the code", keys: "⌥⌘2" },
  { value: "stacked", label: "Below the code", keys: "⌥⌘3" },
  { value: "console", label: "In the console", keys: "⌥⌘4" },
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
    <div className="popover-anchor" ref={box}>
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
          {/* The look applies wherever results sit beside the code. In the
              console they are plain text already. */}
          {layout !== "console" && (
            <>
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
            </>
          )}
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
  { target: "pdf", label: "Render as PDF", hint: "Made with Typst, so no LaTeX is needed" },
];

/**
 * Render, shown only while a Quarto or R Markdown file is in the editor.
 * The button renders the report as its header says. The arrow beside it
 * offers the other formats. While a report renders, it becomes Stop.
 */
function RenderButton() {
  const active = useStore((state) => state.active);
  const rendering = useStore((state) => state.report?.status === "running");
  const { open, setOpen, box } = usePopover();
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
                <span className="menu-hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/** Run and Stop share one place. While R works the button becomes Stop,
 * so stopping never means hunting for a second, smaller control. */
function RunButton() {
  const busy = useStore((state) => state.r.status === "busy");
  if (busy) {
    return (
      <button type="button" className="button run-button is-stop" onClick={stop} title={`Stop, ${keyLabel("⌘.")}`}>
        <StopIcon size={12} /> Stop
      </button>
    );
  }
  return (
    <button type="button" className="button primary run-button" onClick={runLine} title={`Run the line or selection, ${keyLabel("⌘↩")}`}>
      <PlayIcon size={12} /> Run line
    </button>
  );
}
