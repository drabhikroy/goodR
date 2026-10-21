// Why a Shiny app stopped, or what went wrong inside it, in plain words.
//
// The rules are the console's own, from errors.ts, so an error reads the
// same in an app as anywhere else. What an app adds is the file: a syntax
// error names the file and line R could not read, which may be ui.R beside
// the app.R that was run, and the console's rules then find the spot on
// that line. This file depends on nothing but errors.ts, so it can be
// tested alone.

import { explainError, type Explained } from "./errors";
import type { AppFailure } from "./types";

/** Something to press that resolves the failure, when there is one. */
export type AppAction = { label: string; kind: "install"; name: string } | { label: string; kind: "chooseR" | "again" };

/** A failure in plain words. `where.line` counts from zero, as the editor
 * does, and `where.file` is the file that holds it. */
export type AppExplained = {
  title: string;
  detail: string;
  hint?: string;
  action?: AppAction;
  where?: { file: string; line: number; text: string; from: number };
  /** R's own message, kept one click away. */
  original?: string;
};

/** The parts of a console explanation an app can use. */
function fromExplained(explained: Explained): AppExplained {
  const fix = explained.fix;
  const action: AppAction | undefined = fix?.kind === "install" ? { label: fix.label, kind: "install", name: fix.name } : undefined;
  return { title: explained.title, detail: explained.detail, hint: explained.hint, action, original: explained.original };
}

// An app starts from nothing in its own R, which surprises people who just
// made the object in the console.
const CLEAN_START = " Apps run from a clean start in a separate copy of R, so objects made in the console are not there. Create it in the app's own code, above where it is used.";

/**
 * Explains why an app stopped. `textOf` returns a file's text as the editor
 * holds it, or an empty string for a file that is not open, for finding
 * the failing spot.
 */
export function explainApp(failure: AppFailure, textOf: (file: string) => string): AppExplained {
  switch (failure.kind) {
    case "noShiny":
      return {
        title: "The shiny package is not installed yet",
        detail: "Shiny is the package that turns R code into an interactive app. It is installed once, like any other package, and then every app can use it.",
        action: { label: "Install shiny", kind: "install", name: "shiny" },
      };
    case "noShinylive":
      return {
        title: "The shinylive package is not installed yet",
        detail: "shinylive turns a Shiny app into a web page that runs R inside the browser, so whoever opens it needs nothing installed. It is installed once, like any other package.",
        hint: "Install it, then make the web version again. The first time, shinylive also downloads some files of its own, so you need to be online once.",
        action: { label: "Install shinylive", kind: "install", name: "shinylive" },
      };
    case "noR":
      return {
        title: "The R chosen for this app could not be found",
        detail: "Apps run with the same R as the console. It may have been moved or removed since it was chosen.",
        action: { label: "Choose R version", kind: "chooseR" },
      };
    case "stopped":
      return { title: "The app stopped", detail: "Nothing in your script changed. Run it again when you are ready.", action: { label: "Run again", kind: "again" } };
    case "parse":
      return explainParse(failure, textOf(failure.file));
    case "ended": {
      const base = fromExplained(explainError(failure.message, [], ""));
      const clean = /object '.*' not found|could not find function/.test(failure.message) ? CLEAN_START : "";
      return { ...base, detail: `${base.detail}${clean}`, action: base.action ?? { label: "Run again", kind: "again" }, original: failure.message };
    }
  }
}

/** Explains a file R could not read, and finds the spot in it. */
function explainParse(failure: Extract<AppFailure, { kind: "parse" }>, text: string): AppExplained {
  // The console's rules read the parser's own position from this form.
  const parsed = `<text>:${failure.line}:${failure.column}: ${failure.message}`;
  const explained = explainError(failure.message, [], text, [], parsed);
  const base = fromExplained(explained);
  const lines = text.split("\n");
  const spot = explained.where;
  const where = spot && lines[spot.line] !== undefined ? { file: failure.file, line: spot.line, text: lines[spot.line].slice(spot.from, spot.to), from: spot.from } : undefined;
  return { ...base, where: where?.text ? where : undefined, action: base.action ?? { label: "Run again", kind: "again" }, original: `${fileName(failure.file)}:${failure.line}:${failure.column}: ${failure.message}` };
}

/** Explains an error inside a running app, such as code in renderPlot
 * that failed. The app keeps running, so there is nothing to restart. */
export function explainProblem(message: string): AppExplained {
  const base = fromExplained(explainError(message, [], ""));
  const clean = /object '.*' not found|could not find function/.test(message) ? CLEAN_START : "";
  return { ...base, detail: `${base.detail}${clean}`, original: message };
}

/** The last part of a path, for messages. */
function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}
