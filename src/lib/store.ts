// Application state in one place, with React components subscribing to the
// parts they show.
//
// Updates replace changed branches with new objects and leave the rest
// alone, so a component reading `state.objects` re-renders only when the
// objects change, not on every console line.

import { useSyncExternalStore } from "react";
import type { AppInfo, AssistantStatus, PackageInfo, ProjectInfo, RenderFailure, RenderTarget, RInstall, RObject, SetupEvent, Settings } from "./types";

/** Where R is in its life: not started, starting, idle, running, stopped
 * after running, failed to start, or not installed at all. */
export type RStatus = "none" | "starting" | "ready" | "busy" | "stopped" | "failed" | "missing";

/** One piece of a card's output, in the order it arrived. */
export type OutputItem =
  | { type: "stream"; name: string; text: string }
  | { type: "value"; text: string }
  | { type: "plot"; png: string; plot: number }
  | { type: "error"; message: string; traceback: string[]; parsed?: string };

/** A card moves from queued to running to one of the four endings. */
export type BlockStatus = "queued" | "running" | "ok" | "error" | "stopped" | "skipped";

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
  /** Set when the person hides the result, leaving the card's code and
   * title bar in place. */
  collapsed?: boolean;
};

/** One line or block in the console record. */
export type ConsoleEntry = {
  id: number;
  kind: "input" | "stream" | "value" | "error" | "plot" | "info" | "answer";
  text: string;
  name?: string;
};

/** An open tab: a script, or a data frame in the data viewer. Untitled
 * scripts have an untitled: path until saved, and data tabs a data: path. */
export type Tab = { path: string; name: string; dirty: boolean; untitled: boolean; kind?: "script" | "data" };
/** A plot as shown, with the code that drew it, so R can redraw it
 * at another size when exported. */
/** `displayId` names the plot inside R, so a later line that adds to it, such
 * as abline, can redraw this entry instead of adding a second one. */
export type Plot = { png: string; label: string; code: string; displayId?: string };
export type Dialog = null | "settings" | "about" | "chooseR" | "install" | "newProject" | "exportPlot" | "importData" | "assistantSetup";
export type OutlineItem = { label: string; line: number; level: number };

/** The tabs of the right column's two panes, as in RStudio. */
export type TopPane = "environment" | "history" | "assistant";
export type BottomPane = "plots" | "help" | "packages" | "report";

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
  r: { status: RStatus; version: string; generation: number; message: string; log: string; lastDuration: number; workingDir: string };
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
  /** Code placed in the console input for the person to check and run,
   * such as the line that loads a data file. The id changes each time. */
  consoleDraft: { id: number; text: string } | null;
  ui: { inspector: boolean; sidebar: boolean; consoleOpen: boolean; palette: boolean; dialog: Dialog; paletteQuery: string; topPane: TopPane; bottomPane: BottomPane };
  /** The help page on show, with the pages before and after it. */
  help: { page: HelpView | null; back: HelpRef[]; forward: HelpRef[]; query: string; loading: boolean; missing: string };
  /** The file the Import Data dialog opened with, if one was given. */
  importFile: string | null;
  /** Installed packages, read when the Packages pane is shown. */
  packages: PackageInfo[] | null;
  notice: { text: string; tone: "info" | "error" } | null;
  announce: string;
  assistant: AssistantState;
  /** The latest render, or null before the first one. */
  report: ReportState | null;
};

/** Settings for a first launch. They match the Rust defaults in
 * src-tauri/src/settings.rs. */
export const defaultSettings: Settings = {
  rHome: "",
  recentFiles: [],
  sessionFiles: [],
  sessionActive: "",
  recentProjects: [],
  sessionProject: "",
  consoleHeight: 260,
  consoleInputHeight: 96,
  inspectorWidth: 360,
  paneSplit: 45,
  appearance: "system",
  palette: "standard",
  textSize: 100,
  reduceMotion: false,
  layer: "essentials",
  outputLayout: "inline",
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
};

const initial: State = {
  loaded: false,
  info: null,
  settings: defaultSettings,
  installs: [],
  r: { status: "none", version: "", generation: 0, message: "", log: "", lastDuration: 0, workingDir: "" },
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
  ui: { inspector: true, sidebar: true, consoleOpen: true, palette: false, dialog: null, paletteQuery: "", topPane: "environment", bottomPane: "plots" },
  help: { page: null, back: [], forward: [], query: "", loading: false, missing: "" },
  packages: null,
  importFile: null,
  notice: null,
  announce: "",
  assistant: { status: null, model: "", connecting: false, turns: [], answering: null, setup: null },
  report: null,
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

/** Updates one block without touching the others. */
export function updateBlock(id: string, patch: Partial<Block> | ((block: Block) => Partial<Block>)) {
  setState((current) => {
    const block = current.blocks[id];
    if (!block) return {};
    const changes = typeof patch === "function" ? patch(block) : patch;
    return { blocks: { ...current.blocks, [id]: { ...block, ...changes } } };
  });
}
