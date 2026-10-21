// The screen the app opens on when nothing is open. One main way to start,
// a new project, three smaller ones beside it, and the projects and scripts
// opened before, newest first. Fewer, clearer choices are faster to make
// (Hick 1952; Hyman 1953), and recent work is recognized rather than
// recalled (Nielsen 1994). R is already starting while this screen shows.

import {
  baseName,
  chooseAndOpen,
  chooseAndOpenProject,
  folderOf,
  forgetProject,
  forgetRecent,
  newFile,
  openDialog,
  openRecent,
  openRecentProject,
  openUrl,
  rescanR,
  shortPath,
} from "../lib/app";
import { keyLabel } from "../lib/commands";
import { isSupportedR, OLDEST_R } from "../lib/rversion";
import { useStore } from "../lib/store";
import type { RecentFile } from "../lib/types";
import { CloseIcon, FileIcon, FolderIcon, PlusIcon } from "./Icons";

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

export function OpeningScreen() {
  const platform = useStore((state) => state.info?.platform);
  const recents = useStore((state) => state.settings.recentFiles);
  const projects = useStore((state) => state.settings.recentProjects);
  const version = useStore((state) => state.info?.version);
  return (
    <div className="opening">
      <header className={`opening-bar ${platform === "macos" ? "has-traffic-lights" : ""}`} data-tauri-drag-region>
        <button type="button" className="button quiet" onClick={() => openDialog("about")}>
          About
        </button>
        <button type="button" className="button quiet" onClick={() => openDialog("settings")}>
          Settings
        </button>
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
          <p className="lede">Write a line of R and its result appears right beneath it, as one card: your code, then what it made.</p>
          <div className="start-actions">
            <button type="button" className="start primary" onClick={() => openDialog("newProject")}>
              <PlusIcon size={18} />
              <span>New project</span>
              <kbd className="on-accent">{keyLabel("⇧⌘N")}</kbd>
            </button>
            <div className="start-row">
              <button type="button" className="start small" onClick={chooseAndOpenProject}>
                <FolderIcon size={16} />
                <span>Open project</span>
              </button>
              <button type="button" className="start small" onClick={newFile}>
                <PlusIcon size={16} />
                <span>New script</span>
              </button>
              <button type="button" className="start small" onClick={chooseAndOpen}>
                <FileIcon size={16} />
                <span>Open script</span>
              </button>
            </div>
          </div>
          <RLine />
        </section>
        <section className="opening-recents" aria-label="Recent work">
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
                        <span className="muted truncate">{shortPath(folderOf(recent.path))}</span>
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
                          <span className="muted truncate">{shortPath(folderOf(recent.path))}</span>
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
        <span>No telemetry, no accounts</span>
      </footer>
    </div>
  );
}

/** One line about R: which version is in use, or what to do when there
 * is none. A whole card for this was more weight than it deserved. */
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
