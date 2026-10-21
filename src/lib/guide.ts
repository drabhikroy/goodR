// Pointing at parts of the app. Help and the tour can say "show me", and
// the part they mean is marked on screen with rings that widen out from
// its center, then fade, so the eye goes to it wherever it sits. The
// parts are named here once, with how to find each on screen, so help
// text and the tour never depend on how the interface is built.

import { getState, setState } from "./store";

export type GuideTarget = "run" | "results" | "stage" | "timeline" | "prompt" | "objects" | "sheets" | "search" | "session" | "home" | "sidebar" | "canvasToggle";

/** Each part: what to call it, and how to find it on screen. */
export const TARGETS: Record<GuideTarget, { label: string; selector: string }> = {
  run: { label: "Run", selector: ".run-split, .run-button" },
  results: { label: "Results menu", selector: "[data-guide='results']" },
  stage: { label: "The stage", selector: ".stage" },
  timeline: { label: "Earlier results", selector: ".timeline" },
  prompt: { label: "The R prompt", selector: ".composer" },
  objects: { label: "Objects in R", selector: "#object-cards" },
  sheets: { label: "Canvas views", selector: ".canvas-views" },
  search: { label: "Search", selector: ".search-field" },
  session: { label: "What is open", selector: ".project-switch" },
  home: { label: "Home", selector: ".home-button" },
  sidebar: { label: "Project sidebar", selector: ".sidebar" },
  canvasToggle: { label: "Show or hide the canvas", selector: ".panel-toggle" },
};

// How long the rings play before they clear by themselves.
const SHOW_MS = 4200;
let timer: ReturnType<typeof setTimeout> | undefined;
// What to do once the rings clear, such as bringing the tour back.
let after: (() => void) | undefined;

/** The element for a part, when it is on screen. */
export function findTarget(target: GuideTarget): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(TARGETS[target].selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? element : null;
}

/** Marks a part on screen with the widening rings, for a few seconds. */
export function pointAt(target: GuideTarget, then?: () => void) {
  clearTimeout(timer);
  after = then;
  setState((state) => ({ ui: { ...state.ui, beacon: target } }));
  findTarget(target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  timer = setTimeout(stopPointing, SHOW_MS);
}

/** Clears the rings, after their time or early, as any click or key does. */
export function stopPointing() {
  clearTimeout(timer);
  if (getState().ui.beacon) setState((state) => ({ ui: { ...state.ui, beacon: null } }));
  const next = after;
  after = undefined;
  next?.();
}
