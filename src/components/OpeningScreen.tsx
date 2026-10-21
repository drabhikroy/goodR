// Opening screen: new project, script, report, or app, and the recent
// projects and scripts. R starts in the background while it shows.
//
// Home in the title bar brings it back over open work without closing
// anything; Continue working or Escape returns to the workspace.

import { useEffect } from "react";
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
} from "../lib/app";
import { keyLabel } from "../lib/commands";
import { startGuide } from "../lib/firstProject";
import { isSupportedR, OLDEST_R } from "../lib/rversion";
import { useStore } from "../lib/store";
import type { RecentFile } from "../lib/types";
import { AppWindowIcon, ArrowIcon, CloseIcon, FileIcon, FolderIcon, PlusIcon, ReportIcon } from "./Icons";

function group(recents: RecentFile[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime() / 1000;
  const week = today - 6 * 86400;
  const groups: { label: string; items: RecentFile[] }[] = [
    { label: "Today", items: recents.filter((recent) => recent.openedAt >= today) },
    { label: "Earlier this week", items: recents.filter((recent) => recent.openedAt < today && recent.openedAt >= week) },
    { label: "Older", items: recents.filter((recent) => recent.openedAt < week) },
  ];
  return groups.filter((item) => item.items.length);
}

function when(seconds: number) {
  const date = new Date(seconds * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (today.getTime() - date.getTime() < 7 * 86400 * 1000) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One choice on the opening screen: what it makes, in a word and a line. */
function StartButton({ label, Icon, title, hint, keys, onClick }: { label: string; Icon: typeof FileIcon; title: string; hint: string; keys?: string; onClick: () => void }) {
  return (
    <button type="button" className="start" aria-label={label} aria-description={hint} title={keys ? `${label}, ${keyLabel(keys)}` : label} onClick={onClick}>
      <span className="start-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="start-text">
        <strong>{title}</strong>
        <span className="start-hint">{hint}</span>
      </span>
    </button>
  );
}

export function OpeningScreen() {
  const platform = useStore((state) => state.info?.platform);
  const recents = useStore((state) => state.settings.recentFiles);
  const projects = useStore((state) => state.settings.recentProjects);
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
      <main className="opening-grid">
        <section className="opening-hero" aria-labelledby="app-title">
          <img src="/icon.svg" alt="R:" className="hero-icon" width="96" height="96" />
          <h1 id="app-title">
            What Is It
            <br />
            Good For?
          </h1>
          <p className="tagline">Absolutely everything.</p>
          {/* Starting and opening are two groups, each in the order of
              what people make most: a script, a document, an app, then a
              whole project. Each choice says what it makes in a line, so
              nobody has to know the words first. */}
          <div className="start-actions">
            <h2 className="start-heading">Start something new</h2>
            <div className="start-grid">
              <StartButton label="New script" Icon={FileIcon} title="Script" hint="A plain R file" keys="⌘N" onClick={newFile} />
              <StartButton label="New report" Icon={ReportIcon} title="Report" hint="Quarto or R Markdown" keys="⌥⌘N" onClick={() => openDialog("newDocument")} />
              <StartButton label="New Shiny app" Icon={AppWindowIcon} title="Shiny app" hint="An interactive web app" onClick={() => openNewProject("shiny")} />
              <StartButton label="New project" Icon={PlusIcon} title="Project" hint="A folder with its own R" keys="⇧⌘N" onClick={() => openNewProject("analysis")} />
            </div>
            <h2 className="start-heading">Open</h2>
            <div className="start-grid">
              <StartButton label="Open script" Icon={FileIcon} title="Script" hint="An .R, .Rmd, or .qmd file" keys="⌘O" onClick={chooseAndOpen} />
              <StartButton label="Open project" Icon={FolderIcon} title="Project" hint="A folder with an .Rproj file" keys="⇧⌘O" onClick={chooseAndOpenProject} />
            </div>
          </div>
          <RLine />
        </section>
        <section className="opening-recents" aria-label="Recent work">
          {/* Three ways in for someone new to the app or to R, each with a
              line saying what it is, as Start here in Help shows them. */}
          <div className="examples-card">
            <h2>New here?</h2>
            <div className="examples-actions">
              <button type="button" className="examples-action" aria-labelledby="way-examples" aria-describedby="way-examples-hint" onClick={openExamples}>
                <span id="way-examples" className="examples-action-title">Open the examples</span>
                <span id="way-examples-hint" className="examples-action-hint">Seven scripts and documents to try things on</span>
              </button>
              <button type="button" className="examples-action" aria-labelledby="way-tour" aria-describedby="way-tour-hint" onClick={startTour}>
                <span id="way-tour" className="examples-action-title">Take the tour</span>
                <span id="way-tour-hint" className="examples-action-hint">Eleven short steps around the workspace</span>
              </button>
              <button type="button" className="examples-action" aria-labelledby="way-first" aria-describedby="way-first-hint" onClick={startGuide}>
                <span id="way-first" className="examples-action-title">Do a first project</span>
                <span id="way-first-hint" className="examples-action-hint">Five steps with your own data, from a file to a report</span>
              </button>
            </div>
          </div>
          {projects.length > 0 && (
            <div className="recent-block">
              <h2>Projects</h2>
              <ul>
                {projects.map((recent) => (
                  <li key={recent.path} className="recent-row">
                    <button type="button" className="recent" onClick={() => openRecentProject(recent.path)}>
                      <span className="recent-mark" aria-hidden="true">
                        {baseName(recent.path).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="recent-text">
                        <strong>{baseName(recent.path).replace(/\.Rproj$/, "")}</strong>
                        <span className="muted recent-path" title={folderOf(recent.path)}>{shortPath(folderOf(recent.path))}</span>
                      </span>
                      <span className="muted recent-when">{when(recent.openedAt)}</span>
                    </button>
                    <button type="button" className="icon-button recent-forget" aria-label={`Remove ${baseName(recent.path)} from this list`} title="Remove from this list" onClick={() => forgetProject(recent.path)}>
                      <CloseIcon size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="recent-block">
            <h2 id="recent-heading">Scripts</h2>
            {recents.length === 0 && <p className="muted">Scripts you open are listed here, so you can pick up where you left off.</p>}
            {group(recents).map((item) => (
              <div key={item.label} className="recent-group">
                <h3>{item.label}</h3>
                <ul>
                  {item.items.map((recent) => (
                    <li key={recent.path} className="recent-row">
                      <button type="button" className="recent" onClick={() => openRecent(recent.path)}>
                        <FileIcon size={16} />
                        <span className="recent-text">
                          <strong>{baseName(recent.path)}</strong>
                          <span className="muted recent-path" title={folderOf(recent.path)}>{shortPath(folderOf(recent.path))}</span>
                        </span>
                        <span className="muted recent-when">{when(recent.openedAt)}</span>
                      </button>
                      <button type="button" className="icon-button recent-forget" aria-label={`Remove ${baseName(recent.path)} from this list`} title="Remove from this list" onClick={() => forgetRecent(recent.path)}>
                        <CloseIcon size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="drop-hint muted">You can also drop scripts onto this window, or open them from Finder.</p>
        </section>
      </main>
      <footer className="opening-footer">
        <span>Version {version}</span>
        <span>PolyForm Noncommercial 1.0.0</span>
      </footer>
    </div>
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
