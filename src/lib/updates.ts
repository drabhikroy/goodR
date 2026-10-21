// Updates: everything that can be updated, looked for in one pass and
// listed on one page, the Updates pane in Settings.
//
// This app updates itself when its build carries the key that signs its
// releases, and otherwise sends people to the release page. R and a system
// Ollama are installed by their own installers, so the page says which
// version is newest and opens the download. Packages and models update in
// place, through R and Ollama.
//
// Checking for updates happens once a day at most, on its own when the
// setting is on, and always when asked. Nothing is installed without a
// press of a button.

import { announce, backendNow, notify, openDialog, updateAllPackages, updateSettings } from "./app";
import { downloadModel } from "./assistant";
import { getState, sessionOf, setState, type UpdateState } from "./store";

const DAY = 24 * 60 * 60 * 1000;

// What the last quiet check told the user about, so it is not repeated.
let lastNotified = "";

function patch(next: Partial<UpdateState>) {
  setState((state) => ({ updates: { ...state.updates, ...next } }));
}

/** Whether version a is newer than b, comparing each number in turn, so
 * 4.10.0 is newer than 4.9.3. An empty version is never newer. */
export function isNewer(a: string, b: string) {
  if (!a || !b) return false;
  const left = a.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  const right = b.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  for (let k = 0; k < Math.max(left.length, right.length); k += 1) {
    if ((left[k] ?? 0) !== (right[k] ?? 0)) return (left[k] ?? 0) > (right[k] ?? 0);
  }
  return false;
}

/** What has a newer version, in a few words each, such as "this app" or
 * "3 packages". Empty when everything is current. */
export function availableUpdates(state = getState()): string[] {
  const { latest, packages } = state.updates;
  const found: string[] = [];
  if (latest && isNewer(latest.app, state.info?.version ?? "")) found.push("this app");
  if (latest && isNewer(latest.r, state.r.version)) found.push("R");
  const count = packages?.packages.length ?? 0;
  if (count) found.push(count === 1 ? "1 package" : `${count} packages`);
  const ollama = state.assistant.status?.version ?? "";
  if (latest && state.assistant.status?.connected === "system" && isNewer(latest.ollama, ollama)) found.push("Ollama");
  return found;
}

/** Looks for every update at once. Quiet checks, made on their own, say
 * something only when there is an update; asked for, they always answer. */
export async function checkForUpdates(quiet = false) {
  if (getState().updates.checking) return;
  patch({ checking: true });
  const api = backendNow();
  const session = getState().activeSession;
  const [latest, packages] = await Promise.all([
    api.latestVersions().catch(() => null),
    // Asked only of an idle R, and given a minute, so a slow or offline
    // package mirror never holds up the user's own code for long.
    sessionOf(session).r.status === "ready" ? Promise.race([api.outdated(session).catch(() => null), new Promise<null>((done) => setTimeout(() => done(null), 60_000))]) : Promise.resolve(null),
  ]);
  patch({ checking: false, latest, packages });
  if (latest) updateSettings({ lastUpdateCheck: Date.now() });
  const found = availableUpdates();
  const unreachable = !latest?.app && !latest?.r && !packages?.reached;
  // A quiet check says nothing it has already said this session.
  if (quiet && (!found.length || found.join() === lastNotified)) return;
  if (quiet) lastNotified = found.join();
  if (unreachable && !found.length) return notify("Could not look for updates. Check the internet connection and try again.", "error");
  if (!found.length) return announce("Everything is up to date.");
  const list = found.length === 1 ? found[0] : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
  if (quiet) notify(`Updates are ready for ${list}.`, "info", { label: "Review", run: () => openUpdates() });
  else announce(`Updates are ready for ${list}.`);
}

/** Looks for updates on its own, once a day at most, when that is on. It
 * is called a little after opening and then every hour, so an app left
 * open for days still looks. */
export function checkForUpdatesNow() {
  const state = getState();
  const { updateChecks, lastUpdateCheck } = state.settings;
  if (updateChecks !== "auto") return;
  // Packages need an idle R. When it was not ready at the day's check,
  // they are looked at on a later hour, once it is.
  const packagesMissed = !state.updates.packages && sessionOf(state.activeSession).r.status === "ready";
  if (Date.now() - lastUpdateCheck > DAY || packagesMissed) void checkForUpdates(true);
}

/** Opens Settings at the Updates page. */
export function openUpdates() {
  setState((state) => ({ ui: { ...state.ui, settingsPane: "updates" } }));
  openDialog("settings");
}

/** Downloads and installs the newest version of this app, then offers to
 * restart into it. Work in open files is saved as drafts first, as on any
 * quit, so a restart loses nothing. */
export async function updateApp() {
  const api = backendNow();
  const latest = getState().updates.latest;
  if (latest && !latest.appInPlace) {
    await api.openUrl(latest.appPage).catch(() => notify(`The browser did not open. The address is ${latest.appPage}`, "error"));
    return;
  }
  const stop = await api.onUpdateProgress((download) => patch({ download }));
  try {
    const installed = await api.installAppUpdate();
    patch({ download: null, installed });
    if (!installed) notify("This app is already the newest version.");
  } catch (error) {
    patch({ download: null });
    // The release page always has the new version, even when the in-app
    // update cannot be reached.
    const page = latest?.appPage ?? "https://github.com/drabhikroy/goodR/releases/latest";
    notify(String(error).replace(/^Error: /, ""), "error", { label: "Open the release page", run: () => void api.openUrl(page) });
  } finally {
    stop();
  }
}

/** Starts the version just installed. */
export function restartIntoUpdate() {
  void backendNow().restartApp();
}

/** Opens the page to download the newest R or Ollama. */
export function openDownload(kind: "r" | "ollama") {
  const url = kind === "r" ? "https://cran.r-project.org/bin/macosx/" : "https://ollama.com/download";
  backendNow()
    .openUrl(url)
    .catch(() => notify(`The browser did not open. The address is ${url}`, "error"));
}

/** Updates every package with a newer version, with Settings left open so
 * the page shows the update under way. */
export async function updatePackages() {
  const batch = await updateAllPackages();
  if (batch) patch({ packagesBatch: batch });
}

/** Called when the package update run ends: looks again, so the page shows
 * what is still behind, if anything. */
export async function packagesUpdated() {
  patch({ packagesBatch: null });
  const session = getState().activeSession;
  const packages = await backendNow().outdated(session).catch(() => null);
  patch({ packages });
}

/** Fetches every installed model again. Ollama downloads only the parts
 * that changed, so a model that is current takes a moment. */
export async function updateModels() {
  const installed = getState().assistant.status?.installed ?? [];
  if (!installed.length) return;
  patch({ updatingModels: true });
  const failed: string[] = [];
  for (const model of installed) if (!(await downloadModel(model.id))) failed.push(model.id);
  patch({ updatingModels: false });
  if (failed.length) notify(`Could not update ${failed.join(", ")}. Check that Ollama is running, then try again.`, "error");
  else notify(installed.length === 1 ? "The model is up to date." : "Every model is up to date.");
}
