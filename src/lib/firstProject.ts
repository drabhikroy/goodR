// The guided first project: five steps that take someone new to R from a
// data file to a written report, the shape of most analyses.
//
// A step is ticked off when it has been done, however it was done. Each
// also has a button that shows one way to do it.
//
// Which steps are done is read from the state here, apart from the card,
// so it can be tested alone.

import { insertSnippetById, newFile, openDialog, viewData } from "./app";
import { isDocument } from "./chunks";
import { saveResultsAsReport } from "./resultsTools";
import { getState, setState, type State } from "./store";

export type GuideStep = { id: string; title: string; hint: string; action: string; done: boolean };

/** Code that looks at a data frame, cleans it, or summarizes it. */
const LOOKS = /\b(head|str|summary|View|glimpse|names|nrow|dim)\s*\(/;
const CLEANS = /\b(subset|filter|na\.omit|mutate|transform|select|arrange|drop_na)\s*\(|\[[^\]]*,/;

/** The five steps and whether each is done, read from what has happened. */
export function guideSteps(state: Pick<State, "objects" | "tabs" | "blocks" | "plots" | "report">): GuideStep[] {
  const ran = Object.values(state.blocks).filter((block) => block.status === "ok" && !block.restored).map((block) => block.code);
  const frames = state.objects.filter((item) => item.kind === "data");
  const read = frames.length > 0;
  const looked = state.tabs.some((tab) => tab.kind === "data") || ran.some((code) => LOOKS.test(code));
  const cleaned = frames.length > 1 || ran.some((code) => CLEANS.test(code));
  const plotted = state.plots.length > 0;
  const wrote = state.tabs.some((tab) => isDocument(tab.path)) || state.report?.status === "done";
  return [
    { id: "read", title: "Read some data", hint: "A CSV or Excel file becomes a data frame in R.", action: "Import a file", done: read },
    { id: "look", title: "Look at it", hint: "Check the columns, and what kind of values each holds.", action: "Open it in the viewer", done: looked },
    { id: "clean", title: "Keep what matters", hint: "Make a smaller table of just the rows you need.", action: "Insert the code", done: cleaned },
    { id: "plot", title: "Make a plot", hint: "A picture shows the shape of the data at a glance.", action: "Insert a histogram", done: plotted },
    { id: "write", title: "Write it up", hint: "Turn the results into a report you can share.", action: "Save results as a report", done: wrote },
  ];
}

/** Shows the card, with a script to work in when none is open. */
export function startGuide() {
  if (!getState().tabs.length) newFile();
  setState((state) => ({ ui: { ...state.ui, guide: true, showHelp: false, showStart: false } }));
}

export function stopGuide() {
  setState((state) => ({ ui: { ...state.ui, guide: false } }));
}

/** Shows one way to do a step, with the part of the app made for it. */
export function showGuideStep(id: string) {
  const frame = getState().objects.find((item) => item.kind === "data");
  if (id === "read") openDialog("importData");
  else if (id === "look") {
    if (frame) viewData(frame.name);
    else openDialog("importData");
  } else if (id === "clean") insertSnippetById("filter");
  else if (id === "plot") insertSnippetById("histogram");
  else if (id === "write") saveResultsAsReport();
}
