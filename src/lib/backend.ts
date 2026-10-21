// The only way the interface reaches R, the disk, or the system.
//
// In the desktop app these calls go to the Rust commands in src-tauri. In a
// plain browser, used for interface tests and design review, a stand-in
// with a pretend R and a few example scripts takes their place, so every
// screen can be exercised without a desktop build.

import type { Completions } from "./completion";
import type { AnswerEvent, AssistantContext, AssistantStatus, AssistantTask, ChatTurn, MachineSpecs, ModelCatalog, SetupEvent, AppInfo, DataMeta, DataPreview, DataRow, HelpPage, MenuState, PackageInfo, PlotExport, ProjectInfo, ProjectTemplate, REvent, RenderEvent, RenderResult, RenderTarget, RInstall, RObject, SessionInfo, Settings } from "./types";

/** Everything the interface may ask of the system. Each method maps to one
 * Rust command, listed in the same order as in src-tauri/src/lib.rs. */
export interface Backend {
  readonly native: boolean;
  appInfo(): Promise<AppInfo>;
  listRInstalls(): Promise<RInstall[]>;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  updateMenu(state: MenuState): Promise<void>;
  /** Shows the system Open dialog. Only files chosen there, or reopened
   * from the recent list, can be read or written afterward. */
  chooseFiles(): Promise<string[]>;
  chooseSavePath(suggested: string): Promise<string | null>;
  reopen(path: string): Promise<string>;
  forgetRecent(path: string): Promise<void>;
  rememberSession(files: string[], active: string): Promise<void>;
  /** Files handed to the app at launch, from Finder or the command line. */
  takePending(): Promise<string[]>;
  /** Shows the Open dialog for a project file. Null when canceled. */
  chooseProject(): Promise<ProjectInfo | null>;
  reopenProject(file: string): Promise<ProjectInfo>;
  refreshProject(): Promise<ProjectInfo | null>;
  closeProject(): Promise<void>;
  forgetProject(file: string): Promise<void>;
  /** Shows the folder picker for a new project. Only the folder chosen
   * here can be passed to createProject. */
  chooseProjectFolder(existing: boolean): Promise<string | null>;
  createProject(parent: string, name: string, template: ProjectTemplate, git: boolean): Promise<ProjectInfo>;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  savePlot(data: string, suggested: string): Promise<string | null>;
  exportPlot(options: PlotExport, suggested: string): Promise<string | null>;
  startSession(rHome: string, file: string | null): Promise<SessionInfo>;
  currentSession(): Promise<SessionInfo | null>;
  complete(line: string, cursor: number): Promise<Completions>;
  help(topic: string, packageName: string, file: string): Promise<HelpPage>;
  packages(): Promise<PackageInfo[]>;
  preview(code: string): Promise<DataPreview>;
  /** R's parser message for code that does not parse, with its line and
   * column, or empty when it parses. Nothing runs. */
  parseProblem(code: string): Promise<string>;
  chooseDataFile(): Promise<string | null>;
  shutdownSession(): Promise<void>;
  /** Runs code under a run id the caller chose, so the caller can match
   * output that arrives before this call returns. */
  execute(code: string, runId: string): Promise<string>;
  isComplete(code: string): Promise<string>;
  interrupt(): Promise<void>;
  sendInput(value: string): Promise<void>;
  objects(): Promise<RObject[]>;
  missingPackages(names: string[]): Promise<string[]>;
  setPlotSize(width: number, height: number, ratio: number): Promise<void>;
  setPalette(colors: string[]): Promise<void>;
  /** Moves R to the folder of a script that was opened, returning it. */
  setWorkingDir(file: string): Promise<string>;
  dataMeta(name: string): Promise<DataMeta>;
  dataRows(name: string, offset: number, count: number, sortBy: string, descending: boolean): Promise<DataRow[]>;
  confirm(message: string, okLabel: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  onREvent(listener: (generation: number, event: REvent) => void): Promise<() => void>;
  onMenu(listener: (id: string) => void): Promise<() => void>;
  /** Scripts dropped on the window or opened from Finder while running. */
  onOpenFiles(listener: (paths: string[]) => void): Promise<() => void>;
  /** A drag over the window: how many of its files are scripts, or minus
   * one when the drag ends. */
  onDropHover(listener: (scripts: number) => void): Promise<() => void>;
  onDropSkipped(listener: (count: number) => void): Promise<() => void>;
  // The optional assistant, in src-tauri/src/assistant.rs.
  assistantStatus(): Promise<AssistantStatus>;
  assistantConnect(route: "system" | "private"): Promise<string>;
  /** Reads this computer's memory and disk. Called only after the person
   * agrees to the check. */
  assistantSpecs(): Promise<MachineSpecs>;
  assistantCatalog(specs: MachineSpecs | null): Promise<ModelCatalog>;
  assistantInstallRuntime(): Promise<void>;
  assistantPull(model: string): Promise<void>;
  assistantCancelSetup(): Promise<void>;
  assistantDelete(model: string): Promise<void>;
  assistantRemoveRuntime(): Promise<void>;
  assistantAsk(id: string, model: string, task: AssistantTask, context: AssistantContext, history: ChatTurn[]): Promise<void>;
  assistantStop(): Promise<void>;
  onAssistantSetup(listener: (event: SetupEvent) => void): Promise<() => void>;
  onAssistantAnswer(listener: (event: AnswerEvent) => void): Promise<() => void>;
  // Reports, in src-tauri/src/render.rs.
  /** Renders a Quarto or R Markdown file the person opened, in a separate
   * R, and resolves when it finishes, fails, or is stopped. */
  renderStart(id: string, file: string, target: RenderTarget): Promise<RenderResult>;
  renderStop(): Promise<void>;
  /** Opens a rendered file in its usual app, or shows it in Finder. Only
   * files a render made can be opened this way. */
  renderOpen(path: string, reveal: boolean): Promise<void>;
  /** The address the preview loads a rendered file from. */
  previewUrl(path: string): string;
  onRender(listener: (event: RenderEvent) => void): Promise<() => void>;
}

/** The desktop backend. The Tauri modules load only inside the app, so
 * the browser build never pulls them in. */
async function tauriBackend(): Promise<Backend> {
  const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const opener = await import("@tauri-apps/plugin-opener");

  return {
    native: true,
    appInfo: () => invoke("app_info"),
    listRInstalls: () => invoke("list_r_installs"),
    loadSettings: () => invoke("load_settings"),
    saveSettings: (settings) => invoke("save_settings", { settings }),
    updateMenu: (menuState) => invoke("update_menu", { menuState }),
    chooseFiles: () => invoke("choose_files"),
    chooseSavePath: (suggested) => invoke("choose_save_path", { suggested }),
    reopen: (path) => invoke("reopen", { path }),
    forgetRecent: (path) => invoke("forget_recent", { path }),
    rememberSession: (files, active) => invoke("remember_session", { files, active }),
    takePending: () => invoke("take_pending"),
    chooseProject: () => invoke("choose_project"),
    reopenProject: (file) => invoke("reopen_project", { file }),
    refreshProject: () => invoke("refresh_project"),
    closeProject: () => invoke("close_project"),
    forgetProject: (file) => invoke("forget_project", { file }),
    chooseProjectFolder: (existing) => invoke("choose_project_folder", { existing }),
    createProject: (parent, name, template, git) => invoke("create_project", { parent, name, template, git }),
    readText: (path) => invoke("read_text", { path }),
    writeText: (path, contents) => invoke("write_text", { path, contents }),
    savePlot: (data, suggested) => invoke("save_plot", { data, suggested }),
    exportPlot: (options, suggested) => invoke("export_plot", { ...options, suggested }),
    startSession: (rHome, file) => invoke("start_session", { rHome, file }),
    currentSession: () => invoke("current_session"),
    complete: (line, cursor) => invoke("r_complete", { line, cursor }),
    help: (topic, packageName, file) => invoke("r_help", { topic, package: packageName, file }),
    packages: () => invoke("r_packages"),
    preview: (code) => invoke("r_preview", { code }),
    parseProblem: (code) => invoke("r_parse_problem", { code }),
    chooseDataFile: () => invoke("choose_data_file"),
    shutdownSession: () => invoke("shutdown_session"),
    execute: (code, runId) => invoke("execute", { code, runId }),
    isComplete: (code) => invoke("is_complete", { code }),
    interrupt: () => invoke("interrupt"),
    sendInput: (value) => invoke("send_input", { value }),
    objects: () => invoke("r_objects"),
    missingPackages: (names) => invoke("r_missing_packages", { names }),
    setPlotSize: (width, height, ratio) => invoke("r_set_plot_size", { width, height, ratio }),
    setPalette: (colors) => invoke("r_set_palette", { colors }),
    setWorkingDir: (file) => invoke("r_set_working_dir", { file }),
    dataMeta: (name) => invoke("r_data_meta", { name }),
    dataRows: (name, offset, count, sortBy, descending) => invoke("r_data_rows", { name, offset, count, sortBy, descending }),
    // A native dialog, so the question looks and behaves like the system's.
    confirm: (message, okLabel) => dialog.ask(message, { title: "R: What Is It Good For?", kind: "warning", okLabel, cancelLabel: "Cancel" }),
    openUrl: (url) => opener.openUrl(url),
    setTitle: (title) => getCurrentWindow().setTitle(title),
    // Every R message arrives tagged with the session it came from.
    onREvent: (listener) =>
      listen<{ generation: number; event: REvent }>("r-event", (message) => listener(message.payload.generation, message.payload.event)),
    onMenu: (listener) => listen<string>("menu", (message) => listener(message.payload)),
    onOpenFiles: (listener) => listen<string[]>("open-files", (message) => listener(message.payload)),
    onDropHover: (listener) => listen<number>("drop-hover", (message) => listener(message.payload)),
    onDropSkipped: (listener) => listen<number>("drop-skipped", (message) => listener(message.payload)),
    assistantStatus: () => invoke("assistant_status"),
    assistantConnect: (route) => invoke("assistant_connect", { route }),
    assistantSpecs: () => invoke("assistant_specs"),
    assistantCatalog: (specs) => invoke("assistant_catalog", { specs }),
    assistantInstallRuntime: () => invoke("assistant_install_runtime"),
    assistantPull: (model) => invoke("assistant_pull", { model }),
    assistantCancelSetup: () => invoke("assistant_cancel_setup"),
    assistantDelete: (model) => invoke("assistant_delete", { model }),
    assistantRemoveRuntime: () => invoke("assistant_remove_runtime"),
    assistantAsk: (id, model, task, context, history) => invoke("assistant_ask", { id, model, task, context, history }),
    assistantStop: () => invoke("assistant_stop"),
    onAssistantSetup: (listener) => listen<SetupEvent>("assistant-setup", (message) => listener(message.payload)),
    onAssistantAnswer: (listener) => listen<AnswerEvent>("assistant-answer", (message) => listener(message.payload)),
    renderStart: (id, file, target) => invoke("render_start", { id, file, target }),
    renderStop: () => invoke("render_stop"),
    renderOpen: (path, reveal) => invoke("render_open", { path, reveal }),
    // The asset protocol serves only folders a render was granted.
    previewUrl: (path) => convertFileSrc(path),
    onRender: (listener) => listen<RenderEvent>("render-event", (message) => listener(message.payload)),
  };
}

// One backend for the life of the page.
let instance: Promise<Backend> | null = null;

/** The backend for this environment, created once. */
export function backend(): Promise<Backend> {
  if (!instance) {
    const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    instance = native ? tauriBackend() : import("./mockBackend").then((module) => module.createMockBackend());
  }
  return instance;
}
