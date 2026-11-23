// Opening screen: new project, script, report, or app, and the recent
// projects and scripts. R starts in the background while it shows.
//
// Home in the title bar brings it back over open work without closing
// anything; Continue working or Escape returns to the workspace.

import { useEffect, useState } from "react";
import {
  baseName,
  chooseAndOpen,
  chooseAndOpenProject,
  folderOf,
  forgetProject,
  forgetRecent,
  hideStartScreen,
  newFile,
  openDialog,
  openExamples,
  openNewProject,
  openRecent,
  openRecentProject,
  openUrl,
  rescanR,
  shortPath,
  showHelpScreen,
  startTour,
  updateSettings,
} from "../lib/app";
import { keyLabel } from "../lib/commands";
import { startGuide } from "../lib/firstProject";
import { isSupportedR, OLDEST_R } from "../lib/rversion";
import { useStore } from "../lib/store";
import { AppWindowIcon, ArrowIcon, CloseIcon, FileIcon, FolderIcon, PlusIcon, ReportIcon } from "./Icons";

function when(seconds: number) {
  const date = new Date(seconds * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (today.getTime() - date.getTime() < 7 * 86400 * 1000) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One choice on the opening screen, as a compact button. What it makes
 * is in its description and tooltip, so nobody has to know the words first. */
function StartButton({ label, Icon, hint, keys, primary = false, onClick }: { label: string; Icon: typeof FileIcon; hint: string; keys?: string; primary?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`button start ${primary ? "primary" : ""}`} aria-description={hint} title={keys ? `${hint}, ${keyLabel(keys)}` : hint} onClick={onClick}>
      {primary && <Icon size={15} />}
      {label}
    </button>
  );
}

export function OpeningScreen() {
  const platform = useStore((state) => state.info?.platform);
  const hideNewHere = useStore((state) => state.settings.hideNewHere);
  const version = useStore((state) => state.info?.version);
  // Reached from Home, over work still open behind it, rather than shown
  // because nothing is open at all.
  const hasWorkspace = useStore((state) => state.tabs.length > 0 || state.project !== null);
  useEffect(() => {
    if (!hasWorkspace) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideStartScreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasWorkspace]);
  return (
    <div className="opening">
      <header className={`opening-bar ${platform === "macos" ? "has-traffic-lights" : ""}`} data-tauri-drag-region>
        <div className="opening-bar-start">
          {hasWorkspace && (
            <button type="button" className="button quiet" onClick={hideStartScreen}>
              <ArrowIcon direction="left" size={13} />
              Continue working
            </button>
          )}
        </div>
        <div className="opening-bar-end">
          <button type="button" className="button quiet" onClick={showHelpScreen}>
            Help
          </button>
          <button type="button" className="button quiet" onClick={() => openDialog("settings")}>
            Settings
          </button>
        </div>
      </header>
      <main className="opening-main">
        <section className="opening-hero" aria-labelledby="app-title">
          <img src="/icon.svg" alt="R:" className="hero-icon" width="56" height="56" />
          <div>
            <h1 id="app-title">What Is It Good For?</h1>
            <p className="tagline">Absolutely everything.</p>
          </div>
        </section>
        {/* Starting and opening, in one row, in the order of what people
            make most. Each button says in its tooltip what it makes. */}
        <div className="start-row">
          <StartButton label="New script" Icon={FileIcon} hint="A plain R file" keys="⌘N" primary onClick={newFile} />
          <StartButton label="New report" Icon={ReportIcon} hint="Quarto or R Markdown" keys="⌥⌘N" onClick={() => openDialog("newDocument")} />
          <StartButton label="New Shiny app" Icon={AppWindowIcon} hint="An interactive web app" onClick={() => openNewProject("shiny")} />
          <StartButton label="New project" Icon={PlusIcon} hint="A folder with its own R" keys="⇧⌘N" onClick={() => openNewProject("analysis")} />
          <StartButton label="Open script" Icon={FileIcon} hint="An .R, .Rmd, or .qmd file" keys="⌘O" onClick={chooseAndOpen} />
          <StartButton label="Open project" Icon={FolderIcon} hint="A folder with an .Rproj file" keys="⇧⌘O" onClick={chooseAndOpenProject} />
        </div>
        {!hideNewHere && (
          <div className="new-here" role="group" aria-label="New here?">
            <span className="muted">New here?</span>
            <button type="button" className="link-button" aria-description="Eight scripts and documents and four Shiny apps to try things on" onClick={openExamples}>
              Open the examples
            </button>
            <button type="button" className="link-button" aria-description="Eleven short steps around the workspace" onClick={startTour}>
              Take the tour
            </button>
            <button type="button" className="link-button" aria-description="Five steps with your own data, from a file to a report" onClick={startGuide}>
              Do a first project
            </button>
            <button type="button" className="icon-button push-end" aria-label="Put these away" title="Put these away. They stay in the Help menu." onClick={() => updateSettings({ hideNewHere: true })}>
              <CloseIcon size={12} />
            </button>
          </div>
        )}
        <Recent />
      </main>
      <footer className="opening-footer">
        <RLine />
        <span className="push-end">Version {version}</span>
        <span>PolyForm Noncommercial 1.0.0</span>
      </footer>
    </div>
  );
}

type Show = "all" | "projects" | "files";

/** Projects and scripts opened before, in one list, newest first. Each
 * names its folder, so two files with one name are told apart; the full
 * path is in its tooltip. */
function Recent() {
  const files = useStore((state) => state.settings.recentFiles);
  const projects = useStore((state) => state.settings.recentProjects);
  const [show, setShow] = useState<Show>("all");
  const [more, setMore] = useState(false);
  const rows = [...projects.map((item) => ({ ...item, project: true })), ...files.map((item) => ({ ...item, project: false }))]
    .filter((item) => show === "all" || item.project === (show === "projects"))
    .sort((a, b) => b.openedAt - a.openedAt);
  const LIMIT = 8;
  const shown = more ? rows : rows.slice(0, LIMIT);
  const choices: { id: Show; label: string }[] = [
    { id: "all", label: "All" },
    { id: "projects", label: "Projects" },
    { id: "files", label: "Scripts" },
  ];
  return (
    <section className="recent-list" aria-labelledby="recent-heading">
      <div className="recent-head">
        <h2 id="recent-heading">Recent</h2>
        {projects.length > 0 && files.length > 0 && (
          <div className="recent-filter" role="radiogroup" aria-label="Show">
            {choices.map((choice) => (
              <button key={choice.id} type="button" role="radio" aria-checked={show === choice.id} className={show === choice.id ? "is-on" : ""} onClick={() => (setShow(choice.id), setMore(false))}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 && <p className="muted">Projects and scripts you open are listed here, so you can pick up where you left off.</p>}
      <ul>
        {shown.map((recent) => {
          const name = recent.project ? baseName(recent.path).replace(/\.Rproj$/, "") : baseName(recent.path);
          const folder = recent.project ? folderOf(folderOf(recent.path)) : folderOf(recent.path);
          return (
            <li key={`${recent.project}:${recent.path}`} className="recent-row">
              <button type="button" className="recent" title={shortPath(recent.project ? folderOf(recent.path) : recent.path)} onClick={() => (recent.project ? openRecentProject(recent.path) : openRecent(recent.path))}>
                {recent.project ? (
                  <span className="recent-mark" aria-hidden="true">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                ) : (
                  <span className="recent-file" aria-hidden="true">
                    <FileIcon size={15} />
                  </span>
                )}
                <span className="recent-text">
                  <strong>{name}</strong>
                  <span className="muted recent-path">{recent.project ? "Project in " : ""}{baseName(folder) || shortPath(folder)}</span>
                </span>
                <span className="muted recent-when">{when(recent.openedAt)}</span>
              </button>
              <button type="button" className="icon-button recent-forget" aria-label={`Remove ${name} from this list`} title="Remove from this list" onClick={() => (recent.project ? forgetProject(recent.path) : forgetRecent(recent.path))}>
                <CloseIcon size={11} />
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > LIMIT && (
        <button type="button" className="link-button" onClick={() => setMore(!more)}>
          {more ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

/** One line about R: which version is in use, or what to do when there
 * is none. */
function RLine() {
  const installs = useStore((state) => state.installs);
  const status = useStore((state) => state.r.status);
  const rHome = useStore((state) => state.settings.rHome);
  const found = installs.find((install) => install.home === rHome);
  if (!installs.length) {
    return (
      <div className="r-line tone-danger" role="status">
        <span className="r-dot" aria-hidden="true" />
        <span>R is not installed. It is free from CRAN.</span>
        <button type="button" className="button quiet" onClick={() => openUrl("cran")}>
          Get R
        </button>
        <button type="button" className="button quiet" onClick={rescanR}>
          Look again
        </button>
      </div>
    );
  }
  if (found && !isSupportedR(found.version)) {
    return (
      <div className="r-line tone-danger" role="status">
        <span className="r-dot" aria-hidden="true" />
        <span>
          R {found.version} is too old. This app needs R {OLDEST_R} or later.
        </span>
        <button type="button" className="button quiet" onClick={() => openDialog("chooseR")}>
          Choose another
        </button>
      </div>
    );
  }
  const words = !found
    ? "Choose which R to use"
    : status === "ready" || status === "busy"
      ? `R ${found.version} is ready, ${found.source}`
      : status === "starting"
        ? `Starting R ${found.version}`
        : status === "failed"
          ? `R ${found.version} could not start`
          : `Using R ${found.version}, ${found.source}`;
  const tone = !found ? "tone-idle" : status === "starting" ? "tone-busy" : status === "failed" ? "tone-danger" : "tone-ok";
  return (
    <div className={`r-line ${tone}`} role="status">
      <span className="r-dot" aria-hidden="true" />
      <span>{words}</span>
      <button type="button" className="button quiet" onClick={() => openDialog("chooseR")}>
        {found ? "Change" : "Choose"}
      </button>
    </div>
  );
}
