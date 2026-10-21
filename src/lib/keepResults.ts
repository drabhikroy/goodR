// Results kept between visits.
//
// The results in each session's feed are kept on this computer, in the
// browser storage the window already has, and come back when the app
// opens beside the scripts that made them, so a plot made an hour ago is
// still there after a restart without running the whole script again. Each is marked as from last time, since the objects
// behind it are not in R until the code runs again, and running it
// replaces the old result with a new one as usual. A file opened later
// gets its results back when it opens.
//
// Only results of saved files are kept, never untitled ones, and at most
// the latest sixty, so the storage stays small. Turning the setting off,
// or clearing the canvas, forgets them.

import * as editor from "./editor";
import { appendConsole } from "./app";
import { getState, setState, subscribe, type Block } from "./store";

const DB = "goodr";
const STORE = "results";
const KEY = "last";
const LIMIT = 60;
// A plot larger than this is left out, so one huge image cannot fill the
// storage. A typical plot is a few hundred kilobytes.
const PLOT_LIMIT = 3_000_000;

type Kept = Pick<Block, "file" | "code" | "fromLine" | "toLine" | "status" | "items" | "duration">;

// The database stays open for as long as the window is, and is opened
// again only after a failure, so each save does not add a connection.
let database: Promise<IDBDatabase> | null = null;

/** Opens the app's own database, making its one table the first time. */
function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      // Another window asking for a newer version, or the browser closing
      // the database, ends this connection.
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      db.onclose = () => {
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The results database is in use."));
  }).catch((error) => {
    database = null;
    throw error;
  });
  return database;
}

async function read(): Promise<Kept[]> {
  const db = await open();
  return new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => resolve([]);
  });
}

async function write(kept: Kept[]) {
  const db = await open();
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(kept, KEY);
    transaction.oncomplete = () => resolve();
    // A full disk aborts the transaction rather than failing the request.
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

/** The results worth keeping now: finished ones in each session's feed,
 * from saved files, newest last. */
function current(): Kept[] {
  const { sessions, blocks } = getState();
  const kept: Kept[] = [];
  for (const session of Object.values(sessions)) {
    for (const entry of session.console) {
      const block = entry.blockId ? blocks[entry.blockId] : undefined;
      if (!block || block.live || block.undone || block.file.startsWith("untitled:") || block.file.startsWith("data:")) continue;
      if (block.status !== "ok" && block.status !== "error") continue;
      const items = block.items.filter((item) => item.type !== "plot" || item.png.length < PLOT_LIMIT);
      if (!items.length) continue;
      kept.push({ file: block.file, code: block.code, fromLine: block.fromLine, toLine: block.toLine, status: block.status, items, duration: block.duration });
    }
  }
  return kept;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = "";

/** Saves the results a moment after they change, when keeping is on. */
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!getState().settings.keepResults) return;
    // Results still waiting for their file to open are kept as well.
    const kept = [...waiting, ...current()].slice(-LIMIT);
    // A cheap fingerprint skips writing when nothing kept has changed.
    const print = kept.map((item) => `${item.file}:${item.toLine}:${item.items.length}:${item.status}`).join("|");
    if (print === lastSaved) return;
    lastSaved = print;
    // A failed save is tried again on the next change.
    write(kept).catch(() => {
      lastSaved = "";
    });
  }, 1500);
}

/** Forgets every kept result, as when the setting is turned off. */
export function forgetResults() {
  lastSaved = "";
  waiting = [];
  write([]).catch(() => {});
}

// Results kept last time for files not open yet. Each comes back when its
// file opens, and stays kept until then.
let waiting: Kept[] = [];

/**
 * Brings back the results kept for a file that has just opened. A result
 * goes back beside its line only when that line still holds the same
 * code. Otherwise it waits in the feed.
 */
export function restoreKeptFor(path: string) {
  const mine = waiting.filter((item) => item.file === path);
  const tab = getState().tabs.find((candidate) => candidate.path === path);
  if (!mine.length || !tab) return;
  waiting = waiting.filter((item) => item.file !== path);
  const restored: Block[] = mine.map((item) => ({ ...item, id: `block-${crypto.randomUUID()}`, started: 0, live: false, paused: false, restored: true }));
  setState((state) => ({
    blocks: { ...state.blocks, ...Object.fromEntries(restored.map((block) => [block.id, block])) },
    blockOrder: [...state.blockOrder, ...restored.map((block) => block.id)],
  }));
  const text = editor.getText(path).split("\n");
  for (const block of restored) {
    appendConsole(tab.session, { kind: "block", text: "", blockId: block.id });
    if (text.slice(block.fromLine, block.toLine + 1).join("\n") === block.code) editor.attachBlock(path, block.id, block.toLine);
  }
}

/** Reads the results kept last time, brings back those of the files open
 * now, and starts keeping new ones. */
export async function initKeepResults() {
  if (typeof indexedDB === "undefined") return;
  if (getState().settings.keepResults) {
    waiting = await read().catch(() => [] as Kept[]);
    for (const tab of getState().tabs) restoreKeptFor(tab.path);
  }
  subscribe(scheduleSave);
}
