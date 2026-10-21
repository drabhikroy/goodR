// The canvas: object cards along the top, a stage showing one output at a
// time, and the strip of earlier outputs under it. Help, packages, past
// commands, the assistant, reports, and running apps open as sheets over
// it from the buttons on its top bar.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  activateTab,
  checkPackageUpdates,
  clearConsole,
  clearWorkspace,
  helpBack,
  helpForward,
  openDialog,
  openExportPlot,
  openHelp,
  pinOnStage,
  refreshPackages,
  setPackageAttached,
  setPlotArea,
  showPanel,
  showOnStage,
  showPlot,
  stop,
  undoLastRun,
  updateAllPackages,
  isBatchPending,
  togglePart,
  updateSettings,
  viewData,
  viewPlot,
} from "../lib/app";
import { saveResultsAsReport } from "../lib/resultsTools";
import { openTrace } from "../lib/trace";
import { keyLabel } from "../lib/commands";
import * as editor from "../lib/editor";
import { cleanHelp } from "../lib/helpHtml";
import { getState, isQuiet, useStore, type Block, type ConsoleEntry, type Panel } from "../lib/store";
import type { RObject } from "../lib/types";
import { useViewportSize } from "../lib/viewport";
import { firstWarningTitle } from "../lib/warnings";
import { packageProgress } from "../lib/packages";
import { AppWindowIcon, ArrowIcon, BroomIcon, ChartIcon, CloseIcon, FunctionIcon, HelpIcon, HistoryIcon, ImportIcon, ModelIcon, MoreIcon, PackageIcon, PinIcon, PlusIcon, ReportIcon, SaveIcon, SearchIcon, SparkIcon, StopIcon, TableIcon, UndoIcon, ValueIcon } from "./Icons";
import { AssistantPane } from "./AssistantPane";
import { AppPane } from "./AppPane";
import { HistoryList } from "./Composer";
import { DataViewer } from "./DataViewer";
import { OutputCard, PlotFigure } from "./OutputCard";
import { ReportPane } from "./ReportPane";
import { Splitter } from "./Splitter";
import { Popover, usePopover } from "./Popover";
import { StreamText } from "./StreamText";

type Sheet = { id: Exclude<Panel, "canvas">; name: string; Icon: typeof TableIcon };

// The sheets, in the order people reach for them. App and Report join,
// ahead of these, when there is something to show.
const SHEETS: Sheet[] = [
  { id: "help", name: "R help", Icon: HelpIcon },
  { id: "packages", name: "Packages", Icon: PackageIcon },
  { id: "history", name: "History", Icon: HistoryIcon },
];
const REPORT: Sheet = { id: "report", name: "Report", Icon: ReportIcon };
const APP: Sheet = { id: "app", name: "App", Icon: AppWindowIcon };
const ASSISTANT: Sheet = { id: "assistant", name: "Assistant", Icon: SparkIcon };

/** The canvas, when it is shown: its bar, and its stage or a sheet. */
export function Canvas() {
  const open = useStore((state) => state.ui.inspector);
  const width = useStore((state) => state.settings.inspectorWidth);
  const chosen = useStore((state) => state.ui.panel);
  const hasReport = useStore((state) => state.report !== null);
  // The App sheet appears once an app has run, and also whenever a Shiny
  // app's code is in front, for the map of how it connects.
  const hasApp = useStore((state) => state.shinyApp !== null || (state.shinyCheck !== null && state.shinyCheck.file === state.active));
  // The app or report in play comes first, right after the canvas.
  const sheets = [...(hasApp ? [APP] : []), ...(hasReport ? [REPORT] : []), ...SHEETS, ASSISTANT];
  const sheet = sheets.find((item) => item.id === chosen) ?? null;
  const { width: windowWidth } = useViewportSize();
  // The canvas can take up to about two thirds of the window, and never so
  // much that the script is squeezed below a readable width.
  const maxWidth = Math.max(360, Math.min(1100, Math.round(windowWidth * 0.62)));
  const shown = Math.min(width, maxWidth);
  if (!open) return null;
  return (
    <aside className="canvas" id="canvas" tabIndex={-1} aria-label="Canvas" style={{ width: shown }}>
      <Splitter className="column-edge" label="Canvas width" axis="column" value={shown} min={360} max={maxWidth} onChange={(value) => updateSettings({ inspectorWidth: value })} />
      {/* Every view the canvas has, named, in one row: the canvas itself,
          the app or report when there is one, and the sheets. The one on
          show is marked, and any other is one press away. */}
      <nav className="canvas-views" aria-label="Canvas views">
        <button type="button" className={`canvas-view ${sheet ? "" : "is-on"}`} aria-pressed={!sheet} onClick={() => showPanel("canvas")}>
          <ChartIcon size={15} />
          <span className="canvas-view-name">Canvas</span>
        </button>
        {sheets.map((item) => (
          <SheetButton key={item.id} sheet={item} open={sheet?.id === item.id} />
        ))}
      </nav>
      {!sheet && (
        <header className="canvas-bar">
          <ObjectCards />
        </header>
      )}
      {sheet ? (
        <div className="canvas-sheet" id={`sheet-${sheet.id}`}>
          {sheet.id === "help" && <HelpPane />}
          {sheet.id === "packages" && <PackagesPane />}
          {sheet.id === "history" && <HistoryList />}
          {sheet.id === "report" && <ReportPane />}
          {sheet.id === "app" && <AppPane />}
          {sheet.id === "assistant" && <AssistantPane />}
        </div>
      ) : (
        <StageArea />
      )}
    </aside>
  );
}

/** A button on the canvas bar that opens its sheet, or closes it when open.
 * Report and App carry a small dot while they work, or a mark when they
 * failed, so their state shows without the sheet open. */
function SheetButton({ sheet, open }: { sheet: Sheet; open: boolean }) {
  const report = useStore((state) => state.report?.status);
  const app = useStore((state) => state.shinyApp?.status);
  let sign: { tone: string; words: string } | null = null;
  if (sheet.id === "report" && report === "running") sign = { tone: "busy", words: "rendering" };
  if (sheet.id === "report" && report === "failed") sign = { tone: "danger", words: "did not render" };
  if (sheet.id === "app" && (app === "running" || app === "starting")) sign = { tone: "ok", words: app };
  const Icon = sheet.Icon;
  return (
    <button
      type="button"
      data-sheet={sheet.id}
      className={`canvas-view sheet-button ${open ? "is-on" : ""}`}
      aria-pressed={open}
      aria-description={sign?.words}
      title={sign ? `${sheet.name}, ${sign.words}` : sheet.name}
      onClick={() => showPanel(open ? "canvas" : sheet.id)}
    >
      <Icon size={15} />
      <span className="canvas-view-name">{sheet.name}</span>
      {sign && <span className={`view-sign tone-${sign.tone}`} aria-hidden="true" />}
    </button>
  );
}

const KIND_ICON: Record<RObject["kind"], typeof TableIcon> = {
  data: TableIcon,
  model: ModelIcon,
  function: FunctionIcon,
  list: ValueIcon,
  value: ValueIcon,
};

/** The objects in R as a row of small cards. A data frame opens in the data
 * viewer; anything else shows what it is in a small card under the row.
 * A long list shows its first few and a count of the rest. */
function ObjectCards() {
  const objects = useStore((state) => state.objects);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const LIMIT = 8;
  const shown = all ? objects : objects.slice(0, LIMIT);
  const chosen = objects.find((object) => object.name === open);
  return (
    <section className="object-cards" aria-label="Objects in R">
      <div className="object-row" id="object-cards">
        {objects.length === 0 && <span className="muted object-empty">No objects yet</span>}
        {shown.map((object) => {
          const Icon = KIND_ICON[object.kind];
          const viewable = object.kind === "data" && object.class !== "matrix";
          return (
            <button
              key={object.name}
              type="button"
              className={`object-card kind-${object.kind} ${open === object.name ? "is-on" : ""}`}
              aria-label={`${object.name} ${object.summary}`}
              aria-expanded={viewable ? undefined : open === object.name}
              title={`${object.summary}${viewable ? ". Open in the data viewer" : ""}`}
              onClick={() => (viewable ? viewData(object.name) : setOpen(open === object.name ? null : object.name))}
            >
              <span className="object-card-face">
                <Icon size={14} />
                <code>{object.name}</code>
              </span>
            </button>
          );
        })}
        {objects.length > LIMIT && (
          <button type="button" className="object-card is-more" onClick={() => setAll(!all)}>
            <span className="object-card-face">{all ? "Fewer" : `${objects.length - LIMIT} more`}</span>
          </button>
        )}
        <button type="button" className="object-card is-action" onClick={() => openDialog("importData")}>
          <span className="object-card-face">
            <ImportIcon size={14} /> Import data
          </span>
        </button>
        {objects.length > 0 && (
          <button type="button" className="icon-button object-clear" aria-label="Clear all objects" title="Clear all objects" onClick={clearWorkspace}>
            <BroomIcon size={15} />
          </button>
        )}
      </div>
      {chosen && (
        <div className="object-detail" role="status">
          <code>{chosen.name}</code> <span className="muted">{chosen.summary}</span>
          <button type="button" className="button small quiet" onClick={() => openTrace(chosen.name)}>
            Where it came from
          </button>
          {chosen.columns.length > 0 && (
            <ul className="columns">
              {chosen.columns.map((column) => (
                <li key={column}>
                  <code>{column}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** A stretch of the record: one script result, one note, or one command
 * typed at the prompt with everything it printed. */
type Group = { type: "block"; id: number; blockId: string } | { type: "note"; entry: ConsoleEntry } | { type: "typed"; id: number; input: ConsoleEntry | null; out: ConsoleEntry[] };

function groupFeed(entries: ConsoleEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (entry.kind === "block" && entry.blockId) groups.push({ type: "block", id: entry.id, blockId: entry.blockId });
    else if (entry.kind === "info") groups.push({ type: "note", entry });
    else if (entry.kind === "input") groups.push({ type: "typed", id: entry.id, input: entry, out: [] });
    else if (last?.type === "typed") last.out.push(entry);
    else groups.push({ type: "typed", id: entry.id, input: null, out: [entry] });
  }
  return groups;
}

/** Each group's key on the stage and in the timeline. */
function keyOf(group: Group) {
  return group.type === "block" ? `b:${group.blockId}` : group.type === "note" ? `n:${group.entry.id}` : `t:${group.id}`;
}

/** Everything the session has made, oldest first, without script results
 * that printed nothing or that a rerun has since replaced. */
function useOutputs(): Group[] {
  const entries = useStore((state) => state.console);
  const order = useStore((state) => state.blockOrder);
  const blocks = useStore((state) => state.blocks);
  const live = new Set(order);
  // Script results show on the stage whichever layout is chosen: under
  // each line, the script keeps a small copy, and the stage still gives
  // a plot the room to be read.
  return groupFeed(entries).filter((group) => {
    if (group.type !== "block") return true;
    const block = blocks[group.blockId];
    return live.has(group.blockId) && block && !isQuiet(block);
  });
}

/** Puts the script's cursor on the statement that made an output, opening
 * its file first when another is in front. Keyboard focus moves to the
 * script only when asked, so moving along the timeline keeps it there. */
function revealSource(key: string, focus: boolean) {
  if (!key.startsWith("b:")) return;
  const blockId = key.slice(2);
  const block = getState().blocks[blockId];
  if (!block) return;
  if (getState().active !== block.file) activateTab(block.file);
  const to = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  editor.goToLine(block.file, to - (block.toLine - block.fromLine), focus);
}

/** The data frame a statement shows when the statement is just its name,
 * such as `mass_by_species`, which the stage then shows as a table. */
function useBareFrame(blockId: string) {
  const code = useStore((state) => state.blocks[blockId]?.code.trim() ?? "");
  return useStore((state) => state.objects.find((object) => object.name === code && object.kind === "data" && object.class !== "matrix")?.name ?? null);
}

/**
 * The stage and the timeline under it. The stage shows one output at a
 * time, as large as the space allows: a plot scaled to fill it, a data
 * frame as a table, printed text in a block that is easy to read. It
 * follows the work: a new output takes the stage as it arrives, and moving
 * the cursor onto a line that made one brings that one back. The timeline
 * holds every output of the session as a small preview, to go back to any
 * of them, and one can be pinned to stay on the stage above the current
 * one, to compare the two.
 */
function StageArea() {
  const outputs = useOutputs();
  const chosen = useStore((state) => state.ui.stage);
  const pin = useStore((state) => state.ui.stagePin);
  const showTimeline = useStore((state) => state.settings.showTimeline);
  const active = useStore((state) => state.active);
  const cursorLine = useStore((state) => state.cursorLine);
  const blocks = useStore((state) => state.blocks);
  // Notes from the app, such as R starting, are a line of status rather
  // than outputs, so they never take the stage or a place in the timeline.
  const results = outputs.filter((group) => group.type !== "note");
  const notes = outputs.filter((group): group is Extract<Group, { type: "note" }> => group.type === "note");
  const note = notes[notes.length - 1]?.entry.text.replace(/\n$/, "");
  const current = results.find((group) => keyOf(group) === chosen) ?? results[results.length - 1] ?? null;
  const pinned = pin && pin !== (current && keyOf(current)) ? (results.find((group) => keyOf(group) === pin) ?? null) : null;

  // Moving the cursor onto a line that made an output brings it to the
  // stage. Only a move counts, so a choice made in the timeline stays
  // until the cursor moves again.
  useEffect(() => {
    if (!active) return;
    const lines = editor.blockLines(active);
    const here = outputs.find((group) => {
      if (group.type !== "block") return false;
      const block = blocks[group.blockId];
      const to = lines.get(group.blockId);
      return block?.file === active && to !== undefined && cursorLine >= to - (block.toLine - block.fromLine) && cursorLine <= to;
    });
    if (here) showOnStage(keyOf(here));
    // Only the cursor and the file in front decide this.
  }, [cursorLine, active]);

  // The statement whose output is on the stage keeps a bar down its left
  // edge in the script, so the two are always seen as one.
  const staged = current?.type === "block" ? blocks[current.blockId] : undefined;
  const stagedLine = staged && current?.type === "block" ? (editor.blockLines(staged.file).get(current.blockId) ?? staged.toLine) : -1;
  useEffect(() => {
    if (!staged) {
      if (active) editor.markLines(active, "staged", null);
      return;
    }
    editor.markLines(staged.file, "staged", [stagedLine - (staged.toLine - staged.fromLine), stagedLine]);
    // The bar leaves its file when the stage moves on, even to another file.
    return () => editor.markLines(staged.file, "staged", null);
  }, [staged?.id, staged?.file, stagedLine, active]);

  // New plots are rendered at the stage's own size and shape, so they
  // arrive filling it, sharp, with text in proportion.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!body.current) return;
    const observer = new ResizeObserver(([entry]) => setPlotArea(entry.contentRect.width - 32, entry.contentRect.height - 120));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <RunProgress />
      <section className="stage" aria-label="Stage" ref={body}>
        {!current && (
          <div className="feed-empty">
            <StageArt />
            <p className="feed-empty-title">Your plots and results appear here</p>
            <p className="muted">
              Run a line with <kbd>{keyLabel("⌘↩")}</kbd>, or type R in the box under the script. Each plot, table, and printed result fills this space as it arrives, and every one stays in the strip of earlier results underneath.
            </p>
          </div>
        )}
        {pinned && <StagePane group={pinned} pinned />}
        {current && <StagePane group={current} pinned={false} />}
      </section>
      {note && (
        <p className="stage-note truncate" title={note}>
          {note}
        </p>
      )}
      {showTimeline && <Timeline outputs={results} current={current ? keyOf(current) : null} pinned={pin} />}
    </>
  );
}

/** How long R has been running the current statement, in milliseconds,
 * updated twice a second while it runs, or null when it is not running. */
export function useElapsed(): number | null {
  const running = useStore((state) => state.r.status === "busy" && state.r.runStarted > 0);
  const started = useStore((state) => state.r.runStarted);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running, started]);
  return running ? Math.max(0, now - started) : null;
}

/** Seconds in words for progress: "14 s", or "2 min 5 s". */
export function elapsedWords(ms: number) {
  const total = Math.floor(ms / 1000);
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * Progress bar for runs longer than a second: which line, how far through
 * the run, the time so far, and Stop. Only the start is announced to
 * screen readers, so the ticking time does not interrupt them.
 */
function RunProgress() {
  const elapsed = useElapsed();
  const label = useStore((state) => state.r.runLabel);
  const index = useStore((state) => state.r.runIndex);
  const total = useStore((state) => state.r.runTotal);
  if (elapsed === null || elapsed < 1000) return null;
  const where = total > 1 ? `${label}, ${index} of ${total}` : label;
  return (
    <div className="run-progress">
      <span className="run-progress-bar" aria-hidden="true" />
      <span className="visually-hidden" role="status">
        Still running {label}
      </span>
      <span className="run-progress-text">
        Running {where}, <span className="run-progress-time">{elapsedWords(elapsed)}</span>
      </span>
      <button type="button" className="button small quiet push-end" onClick={stop}>
        <StopIcon size={11} /> Stop
      </button>
    </div>
  );
}

/** A small picture of what the stage is for, shown while it is empty: a
 * plot growing into place beside the line of code that makes it. */
function StageArt() {
  return (
    <svg className="vignette stage-art" viewBox="0 0 320 120" aria-hidden="true">
      <rect x="10" y="20" width="110" height="80" rx="8" className="v-card" />
      <rect x="22" y="36" width="70" height="7" rx="3" className="v-line" />
      <rect x="22" y="52" width="86" height="7" rx="3" className="v-line is-on" />
      <rect x="22" y="68" width="54" height="7" rx="3" className="v-line" />
      <path d="M132 60 H170 M160 50 L172 60 L160 70" className="v-arrow" fill="none" />
      <rect x="184" y="14" width="126" height="92" rx="8" className="v-card" />
      <rect x="204" y="70" width="18" height="26" className="v-bar grow" />
      <rect x="236" y="54" width="18" height="42" className="v-bar grow d1" />
      <rect x="268" y="34" width="18" height="62" className="v-bar grow d2" />
    </svg>
  );
}

/** One output on the stage, under a line that names where it came from. */
function StagePane({ group, pinned }: { group: Group; pinned: boolean }) {
  const key = keyOf(group);
  const pin = useStore((state) => state.ui.stagePin);
  // Undo shows on the result of the run it would undo, where the user
  // is already looking, and nowhere else on the stage.
  const batch = useStore((state) => (group.type === "block" ? state.blocks[group.blockId]?.batch : group.type === "typed" ? group.input?.batch : undefined));
  // Not while R is still running it, when there is nothing to undo yet.
  const undoable = useStore((state) => Boolean(batch && state.undo[state.activeSession] === batch && state.r.status !== "busy"));
  return (
    <div className={`stage-pane ${pinned ? "is-pinned" : ""}`} aria-label={pinned ? "Pinned output" : "Output"} role="group">
      <header className="stage-head">
        {group.type === "block" ? (
          <button type="button" className="stage-title is-link" title="Go to this line in the script" onClick={() => revealSource(key, true)}>
            {pinned ? "Pinned: " : ""}
            <OutputLabel group={group} />
          </button>
        ) : (
          <span className="stage-title">
            {pinned ? "Pinned: " : ""}
            <OutputLabel group={group} />
          </span>
        )}
        {undoable && (
          <button type="button" className="button small quiet push-end" title={`Put back the objects this run changed, ${keyLabel("⌥⌘Z")}`} onClick={undoLastRun}>
            <UndoIcon size={14} /> Undo run
          </button>
        )}
        <button type="button" className={`button small quiet ${undoable ? "" : "push-end"}`} aria-pressed={pin === key} onClick={() => pinOnStage(pin === key ? null : key)}>
          <PinIcon size={14} /> {pin === key ? "Unpin" : "Pin"}
        </button>
      </header>
      <div className="stage-body">
        {group.type === "block" && <StageBlock blockId={group.blockId} />}
        {group.type === "typed" && <TypedCard input={group.input} out={group.out} />}
        {group.type === "note" && <p className="feed-note">{group.entry.text.replace(/\n$/, "")}</p>}
      </div>
    </div>
  );
}

/** A script result on the stage: a data frame as a table, anything else
 * as its card, with the printed version of a table one press away. */
function StageBlock({ blockId }: { blockId: string }) {
  const frame = useBareFrame(blockId);
  const [printed, setPrinted] = useState(false);
  if (frame && !printed) {
    return (
      <div className="stage-table">
        <div className="stage-table-bar">
          <button type="button" className="button small quiet" onClick={() => setPrinted(true)}>
            Show as printed
          </button>
        </div>
        <div className="stage-table-frame">
          <DataViewer name={frame} />
        </div>
      </div>
    );
  }
  return (
    <>
      {frame && (
        <div className="stage-table-bar">
          <button type="button" className="button small quiet" onClick={() => setPrinted(false)}>
            Show as a table
          </button>
        </div>
      )}
      <OutputCard blockId={blockId} showLine />
    </>
  );
}

/** Where an output came from, in a few words. */
function OutputLabel({ group }: { group: Group }) {
  const block = useStore((state) => (group.type === "block" ? state.blocks[group.blockId] : undefined));
  if (group.type === "note") return <>Note</>;
  if (group.type === "typed") return <>{group.input?.task === "update" ? "Updating packages" : group.input?.task === "install" ? "Installing packages" : "Typed at the prompt"}</>;
  if (!block) return <>Result</>;
  const to = editor.blockLines(block.file).get(group.blockId) ?? block.toLine;
  const span = block.toLine - block.fromLine;
  return <>{span ? `Lines ${to - span + 1} to ${to + 1}` : `Line ${to + 1}`}</>;
}

type Kind = "plots" | "printed" | "problems";
type Filter = "all" | Kind;

/** What an output mostly is, for the timeline's filters. */
function kindOf(group: Group, blocks: Record<string, Block>): Kind {
  if (group.type === "block") {
    const block = blocks[group.blockId];
    if (block?.items.some((item) => item.type === "plot")) return "plots";
    if (block && (block.status === "error" || block.status === "skipped" || block.status === "stopped")) return "problems";
    return "printed";
  }
  if (group.type === "typed") {
    if (group.out.some((entry) => entry.kind === "plot")) return "plots";
    if (group.out.some((entry) => entry.kind === "error")) return "problems";
  }
  return "printed";
}

const FILTERS: { id: Filter; name: string }[] = [
  { id: "all", name: "All" },
  { id: "plots", name: "Plots" },
  { id: "printed", name: "Printed" },
  { id: "problems", name: "Problems" },
];

// A long script makes many outputs, so past this many the timeline offers
// filters. Below it they would only be clutter.
const FILTER_FROM = 6;
// The strip's height: one row of cards at least, and never so tall that
// the result above it has no room.
const TIMELINE_MIN = 150;
const TIMELINE_MAX = 560;

/**
 * Every output of the session as a small preview, oldest on the left,
 * divided by the sections of the script they came from, so a long script
 * reads as a few named groups rather than one long row. Filters narrow it
 * to plots, printed results, or problems. It is a list box, so the arrow
 * keys move along it and Home and End jump to either end.
 */
function Timeline({ outputs, current, pinned }: { outputs: Group[]; current: string | null; pinned: string | null }) {
  const list = useRef<HTMLDivElement>(null);
  const blocks = useStore((state) => state.blocks);
  const outline = useStore((state) => state.outline);
  const active = useStore((state) => state.active);
  const timelineHeight = useStore((state) => state.settings.timelineHeight);
  const tabs = useStore((state) => state.tabs);
  const [filter, setFilter] = useState<Filter>("all");
  const counts = { all: outputs.length, plots: 0, printed: 0, problems: 0 } as Record<Filter, number>;
  for (const group of outputs) counts[kindOf(group, blocks)] += 1;
  // The filters show only past a handful of results, and a filter left on
  // when they hide again would hide results with no way to turn it off.
  const effective = outputs.length > FILTER_FROM ? filter : "all";
  const shown = effective === "all" ? outputs : outputs.filter((group) => kindOf(group, blocks) === effective);
  // The one on the stage is kept in view as outputs are added.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, outputs.length, filter]);
  if (!outputs.length) return null;

  /** The section of the script an output came from, or its file's name. */
  function sectionOf(group: Group): string {
    if (group.type !== "block") return "Typed at the prompt";
    const block = blocks[group.blockId];
    if (!block) return "";
    if (block.file !== active) return tabs.find((tab) => tab.path === block.file)?.name ?? block.file.split(/[\\/]/).pop() ?? "";
    const line = editor.blockLines(block.file).get(group.blockId) ?? block.toLine;
    return [...outline].reverse().find((item) => item.line <= line)?.label ?? "Top of the script";
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = shown.findIndex((group) => keyOf(group) === current);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(shown.length - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = shown.length - 1;
    else return;
    event.preventDefault();
    if (!shown[next]) return;
    showOnStage(keyOf(shown[next]));
    revealSource(keyOf(shown[next]), false);
    setTimeout(() => list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus(), 0);
  }
  // The filters are one Tab stop, moved between with the arrow keys, as a
  // group of radio buttons is.
  function filterKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const open = FILTERS.filter((item) => item.id === "all" || counts[item.id]);
    const at = open.findIndex((item) => item.id === effective);
    const next = open[(at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : open.length - 1)) % open.length];
    const group = event.currentTarget;
    setFilter(next.id);
    setTimeout(() => group.querySelector<HTMLElement>("[aria-checked='true']")?.focus(), 0);
  }

  let lastSection = "";
  return (
    <div className="timeline" style={{ height: timelineHeight }}>
      <Splitter className="timeline-edge" label="Height of earlier results" axis="row" value={timelineHeight} min={TIMELINE_MIN} max={TIMELINE_MAX} onChange={(value) => updateSettings({ timelineHeight: value })} />
      <div className="timeline-head">
        <span className="timeline-title">
          Earlier results <span className="timeline-count">{outputs.length}</span>
        </span>
        {outputs.length > FILTER_FROM && (
          <div className="timeline-filters" role="radiogroup" aria-label="Show in earlier results" onKeyDown={filterKeys}>
            {FILTERS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={effective === item.id} tabIndex={effective === item.id ? 0 : -1} className={`timeline-filter ${effective === item.id ? "is-on" : ""}`} disabled={item.id !== "all" && !counts[item.id]} onClick={() => setFilter(item.id)}>
                {item.name} <span className="timeline-count">{counts[item.id]}</span>
              </button>
            ))}
          </div>
        )}
        <TimelineMenu />
      </div>
      <div className="timeline-list" role="listbox" aria-label="Earlier results" ref={list} onKeyDown={onKeyDown}>
        {shown.map((group, index) => {
          const key = keyOf(group);
          const selected = key === current;
          const section = sectionOf(group);
          const divider = section !== lastSection;
          lastSection = section;
          return (
            <Fragment key={key}>
              {divider && (
                <span className="timeline-section" aria-hidden="true" title={section}>
                  {section}
                </span>
              )}
              <div
                role="option"
                aria-selected={selected}
                aria-description={section}
                tabIndex={selected || (index === 0 && !shown.some((item) => keyOf(item) === current)) ? 0 : -1}
                className={`timeline-item ${selected ? "is-current" : ""} ${key === pinned ? "is-pinned" : ""}`}
                onClick={() => (showOnStage(key), revealSource(key, false))}
              >
                <Thumb group={group} />
                <span className="timeline-label">
                  <OutputLabel group={group} />
                </span>
              </div>
            </Fragment>
          );
        })}
        {!shown.length && <span className="muted timeline-none">Nothing of this kind yet</span>}
      </div>
    </div>
  );
}

/** What can be done with every earlier result at once, kept behind one
 * small button so the cards have the room. */
function TimelineMenu() {
  const { open, setOpen, box } = usePopover();
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="popover-anchor timeline-menu" ref={box}>
      <button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={open} aria-label="More for earlier results" title="Save as a report, or clear" onClick={() => setOpen(!open)}>
        <MoreIcon size={16} />
      </button>
      {open && (
        <Popover label="Earlier results" className="timeline-popover">
          <button type="button" role="menuitem" autoFocus onClick={() => pick(saveResultsAsReport)}>
            Save as a report
          </button>
          <button type="button" role="menuitem" onClick={() => pick(clearConsole)}>
            Clear all results
          </button>
          <button type="button" role="menuitem" onClick={() => pick(() => togglePart("showTimeline"))}>
            Hide this strip
          </button>
        </Popover>
      )}
    </div>
  );
}

/** The small preview of one output in the timeline. */
function Thumb({ group }: { group: Group }) {
  const block = useStore((state) => (group.type === "block" ? state.blocks[group.blockId] : undefined));
  const plots = useStore((state) => state.plots);
  if (group.type === "note") return <span className="thumb thumb-text muted">{group.entry.text.split("\n")[0]}</span>;
  if (group.type === "typed") {
    if (group.input?.task) return <span className="thumb thumb-text">{group.input.task === "update" ? "Updating packages" : "Installing packages"}</span>;
    const plot = group.out.find((entry) => entry.kind === "plot" && entry.plot !== undefined && plots[entry.plot]);
    if (plot) return <img className="thumb thumb-plot" src={`data:image/png;base64,${plots[plot.plot!].png}`} alt="" />;
    const error = group.out.find((entry) => entry.kind === "error");
    if (error) return <span className="thumb thumb-error">{error.text.split("\n")[0]}</span>;
    const warned = group.out.map((entry) => (entry.name === "stderr" ? firstWarningTitle(entry.text) : null)).find(Boolean);
    if (warned) return <span className="thumb thumb-warning">{warned}</span>;
    const text = group.out.find((entry) => entry.text.trim())?.text ?? group.input?.text ?? "";
    return <code className="thumb thumb-text">{text.trim().split("\n")[0]}</code>;
  }
  if (!block) return <span className="thumb" />;
  const plot = [...block.items].reverse().find((item) => item.type === "plot");
  if (plot && plot.type === "plot") return <img className="thumb thumb-plot" src={`data:image/png;base64,${plot.png}`} alt="" />;
  if (block.undone) return <span className="thumb thumb-text muted">Undone</span>;
  if (block.status === "error") return <span className="thumb thumb-error">Did not run</span>;
  if (block.status === "running") return <span className="thumb thumb-text muted">Running</span>;
  if (block.status === "queued") return <span className="thumb thumb-text muted">Waiting</span>;
  if (block.status === "skipped") return <span className="thumb thumb-text muted">Not run</span>;
  if (block.status === "stopped") return <span className="thumb thumb-text muted">Stopped</span>;
  const warned = block.items.map((item) => (item.type === "stream" && item.name === "stderr" ? firstWarningTitle(item.text) : null)).find(Boolean);
  if (warned) return <span className="thumb thumb-warning">{warned}</span>;
  const text = block.items.find((item) => item.type === "value" || item.type === "stream");
  return <code className="thumb thumb-text">{text && (text.type === "value" || text.type === "stream") ? text.text.trim().split("\n")[0] : block.code.split("\n")[0]}</code>;
}

/** A package install or update: the packages by name, how far along it
 * is, and any that failed, with R's own log one press away. */
function PackageCard({ input, out }: { input: ConsoleEntry; out: ConsoleEntry[] }) {
  const showLog = useStore((state) => state.settings.showPackageLog);
  // Read again whenever R's state changes, which it does as runs start and
  // end.
  const running = useStore((state) => state.r.status !== "ready" && isBatchPending(state.activeSession, input.batch));
  const text = out.map((entry) => entry.text).join("");
  const read = packageProgress(text);
  // A Mac installs ready built packages without saying each is done, so
  // once the run is over, every package fetched that did not fail is in.
  const progress = running ? read : { ...read, done: read.names.filter((name) => !read.failed.includes(name)) };
  const settled = progress.done.length + progress.failed.length;
  const total = progress.names.length;
  const verb = input.task === "update" ? "Updating" : "Installing";
  const summary = progress.upToDate
    ? "Every installed package is up to date."
    : running
      ? total
        ? `${verb} ${settled + 1 > total ? total : settled + 1} of ${total}${progress.current ? `: ${progress.current}` : ""}`
        : "Checking which packages need it"
      : progress.failed.length
        ? `${progress.done.length} of ${total} installed. ${progress.failed.length === 1 ? "One" : progress.failed.length} did not install.`
        : total
          ? `Done. ${total === 1 ? "One package" : `${total} packages`} ${input.task === "update" ? "updated" : "installed"}.${input.task === "update" ? " Restart R to start using the new versions." : ""}`
          : "Finished.";
  return (
    <section className="package-card" aria-label={`${verb} packages`}>
      <p className="package-summary" role="status">
        {summary}
      </p>
      {running && <progress max={Math.max(1, total)} value={total ? settled : undefined} aria-label={`${verb} packages`} />}
      {!showLog && total > 0 && (
        <ul className="package-list">
          {progress.names.map((name) => {
            const state = progress.done.includes(name) ? "done" : progress.failed.includes(name) ? "failed" : name === progress.current && running ? "now" : "waiting";
            return (
              <li key={name} className={`package-item is-${state}`}>
                <span className="package-mark" aria-hidden="true">
                  {state === "done" ? "✓" : state === "failed" ? "!" : state === "now" ? "•" : ""}
                </span>
                <span className="package-name">{name}</span>
                <span className="package-state">{state === "done" ? "Installed" : state === "failed" ? "Did not install" : state === "now" ? "Working" : "Waiting"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="button small quiet" onClick={() => updateSettings({ showPackageLog: !showLog })}>
        {showLog ? "Show the list of packages" : "Show what R printed"}
      </button>
      {showLog && <TypedCard input={input} out={out} plain />}
    </section>
  );
}

/** A command typed at the prompt, and what it printed. */
function TypedCard({ input, out, plain = false }: { input: ConsoleEntry | null; out: ConsoleEntry[]; plain?: boolean }) {
  const plots = useStore((state) => state.plots);
  if (input?.task && !plain) return <PackageCard input={input} out={out} />;
  return (
    <section className="typed-card" aria-label={input ? `Typed: ${input.text.split("\n")[0]}` : "Output"}>
      {input?.undone && <p className="typed-undone">Undone. The objects this command changed are back as they were.</p>}
      {input && (
        <pre className="typed-code">
          {input.text.split("\n").map((line, index) => (
            <div key={index}>
              <span className="prompt" aria-hidden="true">
                {index === 0 ? ">" : "+"}
              </span>
              {line}
            </div>
          ))}
        </pre>
      )}
      {out.map((entry) =>
        entry.kind === "plot" && entry.plot !== undefined && plots[entry.plot] ? (
          <PlotFigure key={entry.id} index={entry.plot} png={plots[entry.plot].png} />
        ) : entry.kind === "error" ? (
          // The headline of a plain error stands out, and the explanation
          // below it reads as ordinary text.
          <div key={entry.id} className="typed-error">
            <pre className="console-error-title">{entry.text.split("\n")[0]}</pre>
            <pre className="console-error-body">{entry.text.split("\n").slice(1).join("\n").replace(/\n$/, "")}</pre>
          </div>
        ) : entry.kind === "stream" ? (
          <StreamText key={entry.id} text={entry.text} name={entry.name ?? "stdout"} className={`typed-out kind-stream ${entry.name === "stderr" ? "is-stderr" : ""}`} />
        ) : (
          <pre key={entry.id} className={`typed-out kind-${entry.kind}`}>
            {entry.text.replace(/\n$/, "")}
          </pre>
        ),
      )}
    </section>
  );
}

/** A plot full size over the window, with the plots before and after it a
 * press or an arrow key away. */
export function PlotViewer() {
  const index = useStore((state) => state.ui.plotView);
  const plots = useStore((state) => state.plots);
  const plot = index === null ? undefined : plots[index];
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") viewPlot(null);
      else if (event.key === "ArrowLeft" && index > 0) viewPlot(index - 1);
      else if (event.key === "ArrowRight" && index < plots.length - 1) viewPlot(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, plots.length]);
  if (index === null || !plot) return null;
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && viewPlot(null)}>
      <div role="dialog" aria-modal="true" aria-label={`Plot ${index + 1} of ${plots.length}, full size`} className="plot-large">
        <img src={`data:image/png;base64,${plot.png}`} alt={`Plot ${index + 1} of ${plots.length}, from ${plot.label}`} />
        <div className="plot-large-bar">
          <button type="button" className="icon-button" aria-label="Earlier plot" disabled={index <= 0} onClick={() => viewPlot(index - 1)}>
            <ArrowIcon direction="left" />
          </button>
          <span className="muted">
            Plot {index + 1} of {plots.length}, from {plot.label}
          </span>
          <button type="button" className="icon-button" aria-label="Later plot" disabled={index >= plots.length - 1} onClick={() => viewPlot(index + 1)}>
            <ArrowIcon direction="right" />
          </button>
          <button type="button" className="button push-end" onClick={() => (showPlot(index), viewPlot(null), openExportPlot())}>
            <SaveIcon size={14} /> Export
          </button>
          <button type="button" className="button" autoFocus onClick={() => viewPlot(null)}>
            <CloseIcon size={14} /> Close
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpPane() {
  const help = useStore((state) => state.help);
  const [query, setQuery] = useState(help.query);
  const article = useRef<HTMLElement>(null);
  useEffect(() => setQuery(help.query), [help.query]);

  const page = help.page;
  // The page is rebuilt from an allowlist and placed with DOM calls, never
  // as raw HTML, so nothing in a help file can run.
  useLayoutEffect(() => {
    const target = article.current;
    if (!target || !page?.html) return;
    target.replaceChildren(cleanHelp(page.html));
    target.scrollTop = 0;
  }, [page?.html]);

  // Links between pages carry their package and file or topic, and open
  // here rather than in a browser.
  function onClick(event: React.MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-package]");
    if (!anchor) return;
    event.preventDefault();
    openHelp(anchor.dataset.topic ?? "", anchor.dataset.package ?? "", anchor.dataset.file ?? "");
  }

  return (
    <section className="help-pane" aria-label="Help">
      <div className="pane-toolbar">
        <button type="button" className="icon-button" aria-label="Previous help page" disabled={!help.back.length} onClick={helpBack}>
          <ArrowIcon direction="left" />
        </button>
        <button type="button" className="icon-button" aria-label="Next help page" disabled={!help.forward.length} onClick={helpForward}>
          <ArrowIcon direction="right" />
        </button>
        <form
          className="pane-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            openHelp(query);
          }}
        >
          <SearchIcon size={14} />
          <input type="search" aria-label="Help topic" placeholder="Function or topic, such as mean" value={query} spellCheck={false} onChange={(event) => setQuery(event.target.value)} />
        </form>
      </div>
      {help.loading && <p className="muted pane-empty">Looking up {help.query} in R</p>}
      {!help.loading && help.missing && <p className="pane-empty">R has no help page for {help.missing}. Check the spelling, or load the package it comes from first.</p>}
      {!help.loading && !help.missing && !page && (
        <p className="muted pane-empty">Type a function's name above, type ?name in the console, or put the cursor on a name in your script and press F1.</p>
      )}
      {!help.loading && !help.missing && page && page.choices.length > 0 && (
        <div className="help-choices">
          <p>{page.topic} is in more than one package. Which one did you mean?</p>
          <ul>
            {page.choices.map((choice) => (
              <li key={`${choice.package}/${choice.file}`}>
                <button type="button" className="button" onClick={() => openHelp("", choice.package, choice.file)}>
                  {choice.package}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <article
        ref={article}
        className="help-doc"
        hidden={help.loading || Boolean(help.missing) || !page?.html}
        aria-label={page ? `Help for ${page.topic}, from ${page.package}` : "Help page"}
        tabIndex={0}
        onClick={onClick}
      />
    </section>
  );
}

function PackagesPane() {
  const packages = useStore((state) => state.packages);
  const [query, setQuery] = useState("");
  useEffect(() => {
    refreshPackages();
  }, []);
  const words = query.trim().toLowerCase();
  const shown = (packages ?? []).filter((item) => !words || item.name.toLowerCase().includes(words) || item.title.toLowerCase().includes(words));
  return (
    <section className="packages-pane" aria-label="Packages">
      <div className="pane-toolbar">
        <label className="pane-search">
          <SearchIcon size={14} />
          <input type="search" aria-label="Search packages" placeholder="Search packages" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="button small" onClick={() => openDialog("install")}>
          <PlusIcon size={14} /> Install
        </button>
      </div>
      {/* Keeping packages current: see what has a newer version, or
          update them all at once, with progress on the stage. */}
      <div className="pane-toolbar">
        <button type="button" className="button small quiet" onClick={checkPackageUpdates}>
          Check for updates
        </button>
        <button type="button" className="button small quiet" onClick={updateAllPackages}>
          Update all
        </button>
      </div>
      {packages === null && <p className="muted pane-empty">Getting the list of installed packages</p>}
      <ul className="package-list">
        {shown.map((item) => (
          <li key={item.name} className="package-row">
            <label className="package-attach">
              <input type="checkbox" checked={item.loaded} disabled={item.name === "base"} onChange={(event) => setPackageAttached(item.name, event.target.checked)} />
              <span className="visually-hidden">Attach {item.name}</span>
            </label>
            <button type="button" className="package-name" onClick={() => openHelp(`${item.name}-package`, item.name)} title={`Help for ${item.name}`}>
              <code>{item.name}</code>
              <span className="muted truncate">{item.title}</span>
            </button>
            <span className="package-version muted">{item.version}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
