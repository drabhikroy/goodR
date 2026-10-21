import { useEffect } from "react";
import { getState, setState, useStore } from "./lib/store";
import { init, runCommand } from "./lib/app";
import { backend } from "./lib/backend";
import { COMMANDS, matchesCombo } from "./lib/commands";
import { Dialogs } from "./components/Dialogs";
import { HelpScreen } from "./components/HelpScreen";
import { OpeningScreen } from "./components/OpeningScreen";
import { Beacon, Tour } from "./components/Tour";
import { setTour } from "./lib/app";
import { Workspace } from "./components/Workspace";
import { FirstProject } from "./components/FirstProject";

let started = false;
let tourOffered = false;

export function App() {
  const loaded = useStore((state) => state.loaded);
  // The workspace appears with the first open file. With none, the
  // opening screen offers new, open, and recent scripts. Home, in the
  // title bar, can also bring the opening screen forward over an open
  // workspace without closing anything; opening or starting anything
  // from it returns to the workspace exactly as it was.
  const hasFiles = useStore((state) => state.tabs.length > 0 || state.project !== null);
  const showStart = useStore((state) => state.ui.showStart);
  // Help shows over either screen the same way, closing nothing.
  const showHelp = useStore((state) => state.ui.showHelp);
  const tourSeen = useStore((state) => state.settings.tourSeen);
  const dialog = useStore((state) => state.ui.dialog);

  // The tour opens by itself once, on the first run, after any question
  // the app asks first, such as which R to use.
  useEffect(() => {
    if (!loaded || tourSeen || dialog || tourOffered) return;
    tourOffered = true;
    setTour(0);
  }, [loaded, tourSeen, dialog]);

  useEffect(() => {
    // React runs effects twice in development. Starting twice would open
    // two R sessions, so the guard is module level.
    if (started) return;
    started = true;
    init();
  }, []);

  useEffect(() => {
    let remove = () => {};
    // React mounts twice in development. Without this flag the first
    // mount's listeners would attach after its cleanup already ran, and
    // every shortcut would fire twice.
    let canceled = false;
    backend().then((api) => {
      // In the desktop app the menu bar owns the shortcuts. The browser
      // build has no menu bar, so shortcuts are matched here instead.
      if (api.native || canceled) return;
      const onKey = (event: KeyboardEvent) => {
        const command = COMMANDS.find((item) => item.combo && matchesCombo(event, item.combo));
        if (!command) return;
        if (command.id === "run.line" || command.id === "run.file") {
          // The editor binds these itself, so here they only need to work
          // when focus is somewhere else.
          if ((event.target as HTMLElement).closest(".cm-editor")) return;
        }
        event.preventDefault();
        runCommand(command.id);
      };
      const onPalette = (event: KeyboardEvent) => {
        // Shift with the same key renders a report instead.
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          runCommand("view.palette");
        }
      };
      window.addEventListener("keydown", onKey);
      window.addEventListener("keydown", onPalette);
      remove = () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keydown", onPalette);
      };
    });
    return () => {
      canceled = true;
      remove();
    };
  }, []);

  if (!loaded) return <div className="splash" aria-busy="true" />;
  return (
    <>
      <div className="window">{showHelp ? <HelpScreen /> : hasFiles && !showStart ? <Workspace /> : <OpeningScreen />}</div>
      {!showHelp && <Tour />}
      {!showHelp && hasFiles && !showStart && <FirstProject />}
      <Beacon />
      <DropOverlay />
      <Dialogs />
      <Notice />
      <LiveRegion />
    </>
  );
}

function Notice() {
  const notice = useStore((state) => state.notice);
  if (!notice) return null;
  return (
    <div className={`notice tone-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      {notice.text}
      {notice.action && (
        <button type="button" className="button small notice-action" onClick={() => (setState({ notice: null }), notice.action!.run())}>
          {notice.action.label}
        </button>
      )}
    </div>
  );
}

/** Says what a drop will do while files are dragged over the window. */
function DropOverlay() {
  const scripts = useStore((state) => state.dropHover);
  if (scripts < 0) return null;
  return (
    <div className={`drop-overlay ${scripts === 0 ? "is-refused" : ""}`} aria-hidden="true">
      <p>{scripts === 0 ? "Only R scripts, R Markdown, and Quarto files open here" : scripts === 1 ? "Drop to open this script" : `Drop to open ${scripts} scripts`}</p>
    </div>
  );
}

/** Announces run results to screen readers without moving focus. */
function LiveRegion() {
  const text = useStore((state) => state.announce);
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

// Exposed for interface tests, which read state directly instead of
// scraping it from the page.
if (typeof window !== "undefined") (window as unknown as { goodfor: unknown }).goodfor = { getState };
