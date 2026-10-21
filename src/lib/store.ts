// Application state in one place, with React components subscribing to the
// parts they show.
//
// Updates replace changed branches with new objects and leave the rest
// alone, so a component reading `state.objects` re-renders only when the
// objects change, not on every console line.

import { useSyncExternalStore } from "react";
import type { GuideTarget } from "./guide";
import type { ShinyFinding } from "./shinyCheck";
import type { ShinyGraph } from "./shinyGraph";
import type { Frame } from "./shinyTrace";
import type { LatestVersions, LatexStatus, OutdatedPackages, RunProfile, StatsReport } from "./types";
import type { Difference } from "./resultDiff";
import type { AppFailure, AppInfo, AssistantStatus, PackageInfo, ProjectInfo, ProjectTemplate, RenderFailure, RenderTarget, RInstall, RObject, SetupEvent, Settings } from "./types";

/** Where R is in its life: not started, starting, idle, running, stopped
 * after running, failed to start, or not installed at all. */
/** What the last look for updates found, and any update under way. */
export type UpdateState = {
  checking: boolean;
  latest: LatestVersions | null;
  packages: OutdatedPackages | null;
  /** The app update's download, in bytes, while it runs. */
  download: { done: number; total: number | null } | null;
  /** The version just installed, waiting for a restart. */
  installed: string | null;
  updatingModels: boolean;
  /** The package update run under way, by its batch, so the Updates page
   * can show it and look again when it ends. */
  packagesBatch: string | null;
};

export type RStatus = "none" | "starting" | "ready" | "busy" | "stopped" | "failed" | "missing";

/** A session's R: its state, version, and folder, and, while it runs, what
 * it is running, since when, and how far through a run of several lines. */
export type RRecord = {
  status: RStatus;
  version: string;
  generation: number;
  message: string;
  log: string;
  lastDuration: number;
  workingDir: string;
  runStarted: number;
  runLabel: string;
  runIndex: number;
  runTotal: number;
};

/** A session's R before it starts. */
export function freshR(): RRecord {
  return { status: "none", version: "", generation: 0, message: "", log: "", lastDuration: 0, workingDir: "", runStarted: 0, runLabel: "", runIndex: 0, runTotal: 0 };
}

/** One piece of a card's output, in the order it arrived. */
export type OutputItem =
  | { type: "stream"; name: string; text: string }
  | { type: "value"; text: string }
  | { type: "plot"; png: string; plot: number }
  | { type: "error"; message: string; traceback: string[]; parsed?: string };

/** A card moves from queued to running to one of the four endings. */
export type BlockStatus = "queued" | "running" | "ok" | "error" | "stopped" | "skipped";

/** The check that a script runs in a new R: running, or how it ended,
 * with the zero based line that failed. */
export type FreshCheck = { file: string; status: "running" | "ok" | "failed"; line: number | null; message: string; ran: number };

/** One run of editor code and everything it produced. */
export type Block = {
  id: string;
  file: string;
  code: string;
  fromLine: number;
  toLine: number;
  status: BlockStatus;
  items: OutputItem[];
  started: number;
  duration: number;
  live: boolean;
  /** Set when a live run took too long. Live output then skips it. */
  paused: boolean;
  /** Set when the user hides the result, leaving the card's code and
   * title bar in place. */
  collapsed?: boolean;
  /** The run this statement was part of. One press of Run is one run, so
   * Undo puts back everything a Run file changed at once. */
  batch?: string;
  /** Where a slow run spent its time, read from R's own sampling. */
  profile?: RunProfile | null;
  /** Set once Undo has put back what this run changed. */
  undone?: boolean;
  /** Set on a result kept from the last time the app was open. Its
   * objects are not in R until the code runs again. */
  restored?: boolean;
  /** The APA write-up and assumption checks, when the statement ran a
   * test or a model. */
  stats?: StatsReport;
  /** The same line's result from the run before, kept to compare with,
   * and the summaries of the objects it touches as they were then. */
  before?: { items: OutputItem[]; objects: Record<string, string> };
  /** What changed since that run, once this one has finished. */
  compared?: Difference;
  /** The check of an exercise in a student's copy: right, not yet, or
   * null when it cannot be checked, with what differs. */
  exercise?: { number: number; ok: boolean | null; message: string };
};

/** A run this long is worth a note on its result. Shorter ones would only
 * add noise. */
export const SLOW_MS = 1000;

/** A statement that ran quickly and printed nothing. It shows as a check
 * beside the line rather than a result. A slow one still gets a result,
 * since how long it took, and why, is worth seeing. */
export function isQuiet(block: Block) {
  const changed = Boolean(block.compared && !block.compared.same);
  return block.status === "ok" && block.items.length === 0 && !block.stats && !changed && !block.exercise && !block.paused && block.duration < SLOW_MS;
}

/** One line or block in the console record. */
export type ConsoleEntry = {
  id: number;
  kind: "input" | "stream" | "value" | "error" | "plot" | "info" | "answer" | "block";
  text: string;
  name?: string;
  /** For a plot, its place in the session's plots. */
  plot?: number;
  /** For a run from the script, the result it stands for in the canvas. */
  blockId?: string;
  /** For a command typed at the prompt, the run it started, for Undo. */
  batch?: string;
  /** Set once Undo has put back what this command changed. */
  undone?: boolean;
  /** For a package install or update the app started, which one, so its
   * result shows as progress by package rather than R's own log. */
  task?: "install" | "update";
};

/** An open tab: a script, or a data frame in the data viewer. Untitled
 * scripts have an untitled: path until saved, and data tabs a data: path. */
export type Tab = {
  path: string;
  name: string;
  dirty: boolean;
  untitled: boolean;
  kind?: "script" | "data";
  /** The key of the R session the tab runs in. A script in a project runs
   * in that project's R, any other script in its own. */
  session: string;
};
/** A plot as shown, with the code that drew it, so R can redraw it
 * at another size when exported. */
/** `displayId` names the plot inside R, so a later line that adds to it, such
 * as abline, can redraw this entry instead of adding a second one. */
export type Plot = { png: string; label: string; code: string; displayId?: string };
export type Dialog = null | "settings" | "about" | "chooseR" | "install" | "newProject" | "newDocument" | "shareApp" | "exportPlot" | "importData" | "assistantSetup" | "rename" | "findInFiles" | "cite" | "trace" | "askOnline" | "fixProblems" | "fileHistory" | "resetApp";
export type OutlineItem = { label: string; line: number; level: number };

/** What the canvas on the right shows: its own feed of results, or one of
 * the sheets that slide over it for a while. */
export type Panel = "canvas" | "help" | "packages" | "history" | "report" | "app" | "assistant";

/** The latest report render: which file, how far it got, the lines it
 * printed, and what it made or why it stopped. `finished` is zero while it
 * runs, and changes with each render so the preview loads the new file. */
export type ReportState = {
  id: string;
  file: string;
  target: RenderTarget;
  status: "running" | "done" | "failed" | "stopped";
  progress: { done: number; total: number; label: string | null } | null;
  log: string[];
  outputs: string[];
  failure: RenderFailure | null;
  started: number;
  finished: number;
};

/** The latest Shiny app run: which file, where it answers, what it printed,
 * the errors inside it while it ran, and why it stopped. */
/** An error inside a running app: R's message, and the stack trace lines
 * Shiny printed after it, which say where it really happened. */
export type AppProblem = { message: string; frames: Frame[]; complete: boolean };

export type ShinyAppState = {
  id: string;
  file: string;
  status: "starting" | "running" | "ended";
  url: string | null;
  log: string[];
  /** Errors inside the running app, newest last. The app keeps running. */
  problems: AppProblem[];
  failure: AppFailure | null;
  /** Changes when the user asks for a fresh load of the page. */
  reloads: number;
  /** The exported folder on show, when this is a preview of the web
   * version rather than the app's own R. */
  preview: string | null;
};

/** Exporting an app as a web page: which app, the files it bundles, the
 * lines the export printed, and the folder it made or why it did not. */
export type ShareState = {
  id: string;
  file: string;
  status: "ready" | "exporting" | "done" | "failed" | "stopped";
  bundle: { files: string[]; more: boolean } | null;
  log: string[];
  folder: string | null;
  failure: AppFailure | null;
};

/** One turn of the assistant conversation. `label` says what was asked in a
 * few words, such as "Explain lines 4 to 6". An answer that came from a
 * selection remembers where that code was, so it can replace it. */
export type AssistantTurn = {
  id: string;
  role: "user" | "assistant";
  label: string;
  text: string;
  done: boolean;
  error: string;
  replace: { file: string; from: number; to: number; code: string } | null;
};

/** The assistant: what was found on this computer, the model in use, the
 * conversation, and any download in progress. */
export type AssistantState = {
  status: AssistantStatus | null;
  /** The model answers come from. Empty until the assistant is ready. */
  model: string;
  connecting: boolean;
  turns: AssistantTurn[];
  /** The answer streaming in now, if any. */
  answering: string | null;
  setup: SetupEvent | null;
};

/** A help page by its package and file, which is how links name them. */
export type HelpRef = { topic: string; package: string; file: string };
/** A help page on show, or the packages to choose from. */
export type HelpView = HelpRef & { html: string; choices: { package: string; file: string }[] };

/** Everything the interface shows. Only the actions in app.ts change it. */
export type State = {
  loaded: boolean;
  info: AppInfo | null;
  settings: Settings;
  installs: RInstall[];
  r: RRecord;
  project: ProjectInfo | null;
  tabs: Tab[];
  active: string | null;
  blocks: Record<string, Block>;
  blockOrder: string[];
  console: ConsoleEntry[];
  history: string[];
  plots: Plot[];
  plotIndex: number;
  objects: RObject[];
  missing: { name: string; line: number }[];
  pendingInput: { prompt: string; password: boolean } | null;
  live: boolean;
  outline: OutlineItem[];
  /** Zero based line of the cursor, so the section bar can say where it is. */
  cursorLine: number;
  /** Scripts being dragged over the window, or minus one when none are. */
  dropHover: number;
  /** Code placed in the console input for the user to check and run,
   * such as the line that loads a data file. The id changes each time. */
  consoleDraft: { id: number; text: string } | null;
  ui: {
    inspector: boolean;
    sidebar: boolean;
    palette: boolean;
    dialog: Dialog;
    paletteQuery: string;
    panel: Panel;
    /** The plot shown full size over the window, or null. */
    plotView: number | null;
    /** The output on the stage, by its key, or null to show the latest. */
    stage: string | null;
    /** An output kept on the stage above the current one, for comparing. */
    stagePin: string | null;
    /** The part of the app being pointed at with rings, or null. */
    beacon: GuideTarget | null;
    /** The template the New Project dialog starts on. */
    newProjectTemplate: ProjectTemplate;
    /** Shows the app's own help over everything, without closing anything. */
    showHelp: boolean;
    /** The step of the tour on show, or null when it is not running. */
    tour: number | null;
    /** Shows the opening screen over the workspace without closing
     * anything, as a browser's home button would. Work keeps running
     * behind it, and any open or new file returns to it. */
    showStart: boolean;
    /** Hides everything but the script and the result on the stage. */
    focus: boolean;
    /** Whether the guided first project's card is showing. */
    guide: boolean;
    /** The pane Settings opens on, when something asks for one. */
    settingsPane: string | null;
  };
  /** The help page on show, with the pages before and after it. */
  help: { page: HelpView | null; back: HelpRef[]; forward: HelpRef[]; query: string; loading: boolean; missing: string };
  /** The file the Import Data dialog opened with, if one was given. */
  importFile: string | null;
  /** Installed packages, read when the Packages pane is shown. */
  packages: PackageInfo[] | null;
  notice: { text: string; tone: "info" | "error"; action?: { label: string; run: () => void } } | null;
  /** What the last look for updates found, and any update under way. */
  updates: UpdateState;
  /** Check it runs from scratch, for one file: under way, or what it found. */
  freshCheck: FreshCheck | null;
  /** Exercises done and attempts made, by student's copy. */
  exerciseProgress: Record<string, { done: number[]; attempts: Record<number, number> }>;
  announce: string;
  assistant: AssistantState;
  /** The latest render, or null before the first one. */
  report: ReportState | null;
  /** The latest Shiny app, running or not, or null before the first. */
  shinyApp: ShinyAppState | null;
  /** Likely mistakes in the Shiny app in front, read from its code. */
  shinyCheck: { file: string; findings: ShinyFinding[]; graph: ShinyGraph } | null;
  /** Exporting an app as a web page, while the Share dialog is open. */
  share: ShareState | null;
  /** Every R session's own record, by key. The active session's record is
   * also copied to the top level, as `r`, `console`, and the rest, where
   * the panes read it, so a pane always shows the session of the tab in
   * front. */
  sessions: Record<string, SessionView>;
  /** The key of the session the panes show. */
  activeSession: string;
  /** The last run in each session that Undo can put back, by session. */
  undo: Record<string, string>;
  /** LaTeX for PDFs: what is on this computer, read when Settings or a
   * failed PDF asks, and the app's own TinyTeX while it installs. */
  latex: { status: LatexStatus | null; installing: boolean; lines: string[]; error: string };
};

/** The parts of the state that belong to one R session. */
export const SESSION_FIELDS = ["r", "project", "console", "history", "plots", "plotIndex", "objects", "pendingInput", "packages"] as const;
export type SessionView = Pick<State, (typeof SESSION_FIELDS)[number]>;

/** The key for untitled work opened when nothing else is. */
export const SCRATCH = "scratch";

/** Settings for a first launch. They match the Rust defaults in
 * src-tauri/src/settings.rs. */
export const defaultSettings: Settings = {
  rHome: "",
  recentFiles: [],
  sessionFiles: [],
  sessionActive: "",
  recentProjects: [],
  sessionProject: "",
  consoleHeight: 230,
  consoleInputHeight: 96,
  timelineHeight: 184,
  showSidebar: true,
  showCanvas: true,
  showPrompt: true,
  showTimeline: true,
  inspectorWidth: 520,
  paneSplit: 45,
  appearance: "system",
  palette: "standard",
  textSize: 100,
  reduceMotion: false,
  layer: "essentials",
  outputLayout: "canvas",
  layoutChosen: false,
  tourSeen: false,
  missingPackages: "ask",
  codeFont: "dm-mono",
  codeSize: 15,
  lineSpacing: "normal",
  ligatures: false,
  lineNumbers: true,
  highlightLine: true,
  wrapLines: false,
  tabWidth: 2,
  closeBrackets: true,
  rainbowBrackets: false,
  resultStyle: "cards",
  copyResults: true,
  assistantRoute: "",
  assistantModel: "",
  runDefaults: {},
  undoRuns: true,
  showPackageLog: false,
  updateChecks: "auto",
  lastUpdateCheck: 0,
  autosave: false,
  renderOnSave: true,
  pdfEngine: "auto",
  latexDir: "",
  hints: true,
  formatOnType: true,
  scriptItalics: false,
  keepResults: true,
  plotStyle: false,
  compact: false,
  readingWidth: true,
};

const initial: State = {
  loaded: false,
  info: null,
  settings: defaultSettings,
  installs: [],
  r: freshR(),
  project: null,
  tabs: [],
  active: null,
  blocks: {},
  blockOrder: [],
  console: [],
  history: [],
  plots: [],
  plotIndex: -1,
  objects: [],
  missing: [],
  pendingInput: null,
  live: false,
  outline: [],
  cursorLine: 0,
  dropHover: -1,
  consoleDraft: null,
  ui: { inspector: true, sidebar: true, palette: false, dialog: null, paletteQuery: "", panel: "canvas", plotView: null, stage: null, stagePin: null, beacon: null, newProjectTemplate: "analysis", showHelp: false, tour: null, showStart: false, focus: false, guide: false, settingsPane: null },
  help: { page: null, back: [], forward: [], query: "", loading: false, missing: "" },
  packages: null,
  importFile: null,
  notice: null,
  updates: { checking: false, latest: null, packages: null, download: null, installed: null, updatingModels: false, packagesBatch: null },
  freshCheck: null,
  exerciseProgress: {},
  announce: "",
  assistant: { status: null, model: "", connecting: false, turns: [], answering: null, setup: null },
  report: null,
  shinyApp: null,
  shinyCheck: null,
  share: null,
  sessions: {},
  activeSession: SCRATCH,
  undo: {},
  latex: { status: null, installing: false, lines: [], error: "" },
};

// The single copy of state, and the components listening to it.
let state: State = initial;
const listeners = new Set<() => void>();

/** The current state, for code outside React. */
export function getState(): State {
  return state;
}

/** Replaces part of the state and tells every subscriber. */
export function setState(patch: Partial<State> | ((current: State) => Partial<State>)) {
  const changes = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

/** Registers a listener, returning the function that removes it. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads part of the state. The selector must return an existing value or a
 * primitive, never a freshly built object, or React would re-render forever. */
export function useStore<T>(selector: (current: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/** A session before its R has started. */
export function emptySession(): SessionView {
  return {
    r: freshR(),
    project: null,
    console: [],
    history: [],
    plots: [],
    plotIndex: -1,
    objects: [],
    pendingInput: null,
    packages: null,
  };
}

/** One session's record, or an empty one for a session not seen yet. */
export function sessionOf(key: string): SessionView {
  return state.sessions[key] ?? emptySession();
}

/**
 * Changes one session's record. When it is the session on show, the copy
 * at the top level changes with it, so the panes stay in step.
 */
export function patchSession(key: string, patch: Partial<SessionView> | ((current: SessionView) => Partial<SessionView>)) {
  setState((current) => {
    const before = current.sessions[key] ?? emptySession();
    const changes = typeof patch === "function" ? patch(before) : patch;
    const sessions = { ...current.sessions, [key]: { ...before, ...changes } };
    return key === current.activeSession ? { sessions, ...changes } : { sessions };
  });
}

/** Shows a session in the panes, copying its record to the top level. */
export function showSession(key: string) {
  if (key === state.activeSession && state.sessions[key]) return;
  setState((current) => ({ activeSession: key, ...(current.sessions[key] ?? emptySession()) }));
}

/** Forgets a session whose R has ended for good, as when its script closes. */
export function dropSession(key: string) {
  setState((current) => {
    const sessions = { ...current.sessions };
    delete sessions[key];
    return { sessions };
  });
}

/** Updates one block without touching the others. */
export function updateBlock(id: string, patch: Partial<Block> | ((block: Block) => Partial<Block>)) {
  setState((current) => {
    const block = current.blocks[id];
    if (!block) return {};
    const changes = typeof patch === "function" ? patch(block) : patch;
    return { blocks: { ...current.blocks, [id]: { ...block, ...changes } } };
  });
}
