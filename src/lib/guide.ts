// Show me: a short guided walk through the parts of the app a Help topic
// or a tour step is about. Each step dims the window and closes an iris on
// one part, ringed in blue, while a pointer glides there and a card says
// what the part does, with Back, Next, and Done. The parts are named here
// once, with how to find each on screen and a sentence about it, so Help
// and the tour never depend on how the interface is built.

import { getState, setState } from "./store";

export type GuideTarget = "run" | "results" | "stage" | "timeline" | "prompt" | "objects" | "sheets" | "search" | "session" | "guide" | "home" | "sidebar" | "canvasToggle";

/**
 * Each part: what to call it, how to find it on screen, what to say about
 * it, and whether it is something to press, in which case the pointer
 * shows a press.
 */
export const TARGETS: Record<GuideTarget, { label: string; selector: string; text: string; press?: boolean }> = {
  run: {
    label: "Run",
    selector: ".run-split, .run-button",
    text: "Run sends the line under the cursor to R. Its result appears on the canvas a moment later.",
    press: true,
  },
  results: {
    label: "Run menu",
    selector: ".run-split .split-arrow",
    text: "The arrow beside Run holds the other ways to run, such as a section or the whole file, and where results go.",
    press: true,
  },
  stage: { label: "The stage", selector: ".stage", text: "The stage shows one result at a time, as large as it fits. Each new result takes its place as it arrives." },
  timeline: { label: "All results", selector: ".all-results, .timeline", text: "All results lays out every result from this session. Press one to bring it back to the stage.", press: true },
  prompt: { label: "The R prompt", selector: ".composer", text: "Type R here and press Return to run it without adding it to your script." },
  objects: {
    label: "Objects",
    selector: ".tool-button[data-sheet='objects']",
    text: "Objects lists what you have made in R, with a few words about each. Press a data frame to look through it.",
    press: true,
  },
  sheets: { label: "Tools", selector: ".tool-strip", text: "The tools run down the right edge. Rest the pointer on one for its name, or right-click here to show every name." },
  search: { label: "Search", selector: ".search-field", text: "Search finds any command by name and looks up any function in R help.", press: true },
  session: {
    label: "What is open",
    selector: ".project-switch",
    text: "This names the project or script on show. Its menu lists the project's files, everything open, and which R is running.",
    press: true,
  },
  guide: { label: "Help", selector: ".tool-button[data-sheet='guide']", text: "Help opens these pages from anywhere, over your work.", press: true },
  home: { label: "Home", selector: ".tool-button[data-sheet='home']", text: "Home shows the opening screen without closing anything.", press: true },
  sidebar: { label: "Project sidebar", selector: ".sidebar", text: "The sidebar lists the project's scripts and data files, one press from each." },
  canvasToggle: {
    label: "Show or hide the canvas",
    selector: ".tool-button[data-sheet='canvas']",
    text: "Press Results while it is on show to hide the canvas and give the script the whole width.",
    press: true,
  },
};

/** A walk in progress: the parts in order, and the one on show. */
export type Walk = { steps: GuideTarget[]; index: number };

// What to do once the walk ends, such as bringing the tour back.
let after: (() => void) | undefined;

/** The element for a part, when it is on screen. */
export function findTarget(target: GuideTarget): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(TARGETS[target].selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? element : null;
}

/** Starts a walk through some parts of the app, one step each. */
export function startWalk(steps: GuideTarget[], then?: () => void) {
  if (!steps.length) return;
  after = then;
  findTarget(steps[0])?.scrollIntoView({ block: "nearest", inline: "nearest" });
  setState((state) => ({ ui: { ...state.ui, beacon: { steps, index: 0 } } }));
}

/** Moves the walk to another step. */
export function walkTo(index: number) {
  const walk = getState().ui.beacon;
  if (!walk || index < 0 || index >= walk.steps.length) return;
  findTarget(walk.steps[index])?.scrollIntoView({ block: "nearest", inline: "nearest" });
  setState((state) => ({ ui: { ...state.ui, beacon: { ...walk, index } } }));
}

/** Ends the walk, with Done or Escape. */
export function stopPointing() {
  if (getState().ui.beacon) setState((state) => ({ ui: { ...state.ui, beacon: null } }));
  const next = after;
  after = undefined;
  next?.();
}
