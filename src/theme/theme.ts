// Applies the color tokens, text size, and motion preference to the page.
//
// Every color in the interface comes from tokens.json through CSS custom
// properties set here, so the contrast audit that reads the same file covers
// everything people see.

import tokens from "./tokens.json";
import type { Appearance, CodeFont, LineSpacing, PaletteName, Settings } from "../lib/types";

type Mode = "light" | "dark" | "paper";

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const motionQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function resolveMode(appearance: Appearance): Mode {
  if (appearance === "system") return darkQuery?.matches ? "dark" : "light";
  return appearance;
}

function cssName(key: string) {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Each code typeface with fallbacks, so code always shows in a monospace
 * face even before the bundled font has loaded. */
export const CODE_FONTS: Record<CodeFont, { label: string; stack: string; ligatures: boolean; comments?: string; note?: string }> = {
  "dm-mono": { label: "DM Mono", stack: '"DM Mono", ui-monospace, monospace', ligatures: false },
  "jetbrains-mono": { label: "JetBrains Mono", stack: '"JetBrains Mono Variable", ui-monospace, monospace', ligatures: true },
  "ibm-plex-mono": { label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace', ligatures: false },
  "fira-code": { label: "Fira Code", stack: '"Fira Code Variable", ui-monospace, monospace', ligatures: true },
  "source-code-pro": { label: "Source Code Pro", stack: '"Source Code Pro Variable", ui-monospace, monospace', ligatures: false },
  "cascadia-code": { label: "Cascadia Code", stack: '"Cascadia Code Variable", ui-monospace, monospace', ligatures: true },
  "victor-mono": { label: "Victor Mono", stack: '"Victor Mono Variable", ui-monospace, monospace', ligatures: true },
  "monaspace-neon": { label: "Monaspace Neon", stack: '"Monaspace Neon", ui-monospace, monospace', ligatures: true },
  "commit-mono": { label: "Commit Mono", stack: '"Commit Mono", ui-monospace, monospace', ligatures: false },
  "geist-mono": { label: "Geist Mono", stack: '"Geist Mono Variable", ui-monospace, monospace', ligatures: false },
  iosevka: { label: "Iosevka", stack: '"Iosevka", ui-monospace, monospace', ligatures: true },
  "atkinson-hyperlegible-mono": { label: "Atkinson Hyperlegible Mono", stack: '"Atkinson Hyperlegible Mono Variable", ui-monospace, monospace', ligatures: false },
  "intel-one-mono": { label: "Intel One Mono", stack: '"Intel One Mono", ui-monospace, monospace', ligatures: false },
  system: { label: "The system's monospace", stack: "ui-monospace, Menlo, Consolas, monospace", ligatures: false },
  // Pairings: one face for code and another, a script or handwritten
  // italic, for comments. Fira Code iScript cannot be shipped, since its
  // italic is the commercial Script12, so it is used when installed and
  // otherwise stands in with Fira Code and Victor Mono's italic.
  "fira-code-iscript": {
    label: "Fira Code iScript",
    stack: '"Fira Code iScript", "Fira Code Variable", ui-monospace, monospace',
    ligatures: true,
    comments: '"Fira Code iScript", "Victor Mono Variable", ui-monospace, monospace',
    note: "Uses Fira Code iScript when it is installed on this computer, and Fira Code with Victor Mono's script italic when it is not.",
  },
  "jetbrains-mono-radon": {
    label: "JetBrains Mono with handwritten comments",
    stack: '"JetBrains Mono Variable", ui-monospace, monospace',
    ligatures: true,
    comments: '"Monaspace Radon", ui-monospace, monospace',
  },
};

/** Line height for each spacing choice. */
export const LINE_HEIGHTS: Record<LineSpacing, number> = { compact: 1.45, normal: 1.65, relaxed: 1.9 };

type ThemeSettings = Pick<Settings, "appearance" | "palette" | "textSize" | "reduceMotion" | "codeFont" | "codeSize" | "lineSpacing" | "ligatures" | "resultStyle" | "compact" | "readingWidth" | "scriptItalics">;

export function applyTheme(settings: ThemeSettings) {
  const mode = resolveMode(settings.appearance);
  const root = document.documentElement;
  const values: Record<string, string> = {
    ...tokens.modes[mode],
    ...paletteColors(settings.palette, mode),
  };
  for (const [key, value] of Object.entries(values)) root.style.setProperty(cssName(key), value);
  root.dataset.mode = mode;
  root.dataset.palette = settings.palette;
  // The interface scales with the text size setting, so controls grow with
  // their labels instead of clipping them.
  // The base is 15 pixels at 100 percent, a step up from the 14 that read
  // as too small in the panes beside the script.
  root.style.fontSize = `${(settings.textSize / 100) * 15}px`;
  // Code has its own size and face, set apart from the interface, since
  // people tune the two separately.
  const font = CODE_FONTS[settings.codeFont] ?? CODE_FONTS["dm-mono"];
  root.style.setProperty("--code-font", font.stack);
  root.style.setProperty("--code-size", `${Math.min(24, Math.max(11, settings.codeSize || 15))}px`);
  root.style.setProperty("--code-line", String(LINE_HEIGHTS[settings.lineSpacing] ?? LINE_HEIGHTS.normal));
  root.style.setProperty("--code-ligatures", settings.ligatures && font.ligatures ? "normal" : "none");
  // Script italics: comments in Victor Mono's flowing italic, whatever the
  // code's own typeface, the effect of Fira Code iScript with a typeface
  // that is free to bundle.
  root.style.setProperty("--comment-font", font.comments ?? (settings.scriptItalics ? '"Victor Mono Variable", ui-monospace, monospace' : "inherit"));
  root.dataset.results = settings.resultStyle === "plain" ? "plain" : "cards";
  const reduce = settings.reduceMotion || Boolean(motionQuery?.matches);
  root.dataset.motion = reduce ? "reduce" : "full";
  // Compact tightens the space around panes, not the size of targets.
  root.dataset.density = settings.compact ? "compact" : "comfortable";
  root.dataset.reading = settings.readingWidth ? "narrow" : "full";
  // Paper is a light page, so the browser's own controls stay light on it.
  root.style.colorScheme = mode === "dark" ? "dark" : "light";
}

/** A palette's status and syntax colors for a mode. Paper is a light page,
 * so it takes each palette's light colors. */
export function paletteColors(palette: PaletteName, mode: Mode) {
  const set = tokens.palettes[palette] ?? tokens.palettes.standard;
  return mode === "dark" ? set.dark : set.light;
}

export function plotColors(palette: PaletteName): string[] {
  return tokens.plotColors[palette];
}

/** Calls `listener` when the system switches between light and dark. */
export function watchSystemAppearance(listener: () => void): () => void {
  darkQuery?.addEventListener("change", listener);
  motionQuery?.addEventListener("change", listener);
  return () => {
    darkQuery?.removeEventListener("change", listener);
    motionQuery?.removeEventListener("change", listener);
  };
}
