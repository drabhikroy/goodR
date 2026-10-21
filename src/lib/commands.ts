// The command list behind the palette and the keyboard shortcuts. Ids match
// the menu bar items in src-tauri/src/menu.rs, and `runCommand` in app.ts
// carries out each one.

export type Command = {
  id: string;
  title: string;
  section: string;
  /** Shown beside the title. Uses Mac symbols on a Mac. */
  keys?: string;
  /** The same shortcut in KeyboardEvent terms, for the browser build. */
  combo?: string;
  /** Shown only in the Everything layer. */
  advanced?: boolean;
};

export const COMMANDS: Command[] = [
  { id: "run.line", title: "Run line or selection", section: "Run", keys: "⌘↩", combo: "Mod+Enter" },
  { id: "run.file", title: "Run file", section: "Run", keys: "⇧⌘↩", combo: "Shift+Mod+Enter" },
  { id: "run.toHere", title: "Run to here", section: "Run", keys: "⌥⌘B", combo: "Alt+Mod+b", advanced: true },
  { id: "run.stop", title: "Stop", section: "Run", keys: "⌘.", combo: "Mod+." },
  { id: "run.restart", title: "Restart R", section: "Run", keys: "⇧⌘0", combo: "Shift+Mod+0" },
  { id: "run.restartRunAll", title: "Restart R and run file", section: "Run", advanced: true },
  { id: "run.chooseR", title: "Choose R version", section: "Run" },
  { id: "run.clearOutput", title: "Clear output", section: "Run" },
  { id: "run.clearConsole", title: "Clear console", section: "Run", keys: "⌘L", combo: "Mod+l" },
  { id: "render.report", title: "Render report", section: "Run", keys: "⇧⌘K", combo: "Shift+Mod+k" },
  { id: "render.html", title: "Render report as HTML", section: "Run", advanced: true },
  { id: "render.word", title: "Render report as Word", section: "Run", advanced: true },
  { id: "render.pdf", title: "Render report as PDF", section: "Run", advanced: true },
  { id: "render.stop", title: "Stop rendering", section: "Run" },
  { id: "file.new", title: "New script", section: "File", keys: "⌘N", combo: "Mod+n" },
  { id: "file.open", title: "Open script", section: "File", keys: "⌘O", combo: "Mod+o" },
  { id: "project.new", title: "New project", section: "File", keys: "⇧⌘N", combo: "Shift+Mod+n" },
  { id: "project.open", title: "Open project", section: "File", keys: "⇧⌘O", combo: "Shift+Mod+o" },
  { id: "project.close", title: "Close project", section: "File" },
  { id: "file.save", title: "Save", section: "File", keys: "⌘S", combo: "Mod+s" },
  { id: "file.saveAs", title: "Save as", section: "File", keys: "⇧⌘S", combo: "Shift+Mod+s" },
  { id: "file.saveAll", title: "Save all", section: "File", keys: "⌥⌘S", combo: "Alt+Mod+s" },
  { id: "file.exportPlot", title: "Export plot", section: "File", keys: "⇧⌘E", combo: "Shift+Mod+e" },
  { id: "file.close", title: "Close tab", section: "File", keys: "⌘W", combo: "Mod+w" },
  { id: "edit.find", title: "Find and replace", section: "Edit", keys: "⌘F" },
  { id: "edit.comment", title: "Comment lines", section: "Edit", keys: "⇧⌘C", combo: "Shift+Mod+c" },
  { id: "view.output.inline", title: "Show results under each line", section: "View", keys: "⌥⌘1", combo: "Alt+Mod+1" },
  { id: "view.output.side", title: "Show results beside the code", section: "View", keys: "⌥⌘2", combo: "Alt+Mod+2" },
  { id: "view.output.stacked", title: "Show results below the code", section: "View", keys: "⌥⌘3", combo: "Alt+Mod+3" },
  { id: "view.output.console", title: "Show results in the console", section: "View", keys: "⌥⌘4", combo: "Alt+Mod+4" },
  { id: "view.style.cards", title: "Show results as cards", section: "View" },
  { id: "view.style.plain", title: "Show results as plain text", section: "View" },
  { id: "view.live", title: "Update results as you type", section: "View", keys: "⌥⌘L", combo: "Alt+Mod+l" },
  { id: "view.sidebar", title: "Show or hide sidebar", section: "View", keys: "⌃⌘S" },
  { id: "view.console", title: "Show or hide console history", section: "View", keys: "⇧⌘Y", combo: "Shift+Mod+y" },
  { id: "view.inspector", title: "Show or hide panes", section: "View", keys: "⌥⌘0", combo: "Alt+Mod+0" },
  { id: "view.layer.essentials", title: "Use the Essentials menus", section: "View" },
  { id: "view.layer.everything", title: "Use the Everything menus", section: "View" },
  { id: "view.zoomIn", title: "Larger text", section: "View", keys: "⌘=", combo: "Mod+=" },
  { id: "view.zoomOut", title: "Smaller text", section: "View", keys: "⌘−", combo: "Mod+-" },
  { id: "packages.install", title: "Install packages", section: "Packages" },
  { id: "packages.installMissing", title: "Install missing packages for this file", section: "Packages" },
  { id: "packages.auto", title: "Install missing packages automatically", section: "Packages" },
  { id: "focus.editor", title: "Move to the editor", section: "Window", keys: "⌃1", combo: "Ctrl+1" },
  { id: "focus.console", title: "Move to the console", section: "Window", keys: "⌃2", combo: "Ctrl+2" },
  { id: "focus.help", title: "Show help", section: "Window", keys: "⌃3", combo: "Ctrl+3" },
  { id: "focus.history", title: "Show history", section: "Window", keys: "⌃4", combo: "Ctrl+4" },
  { id: "focus.plots", title: "Show plots", section: "Window", keys: "⌃6", combo: "Ctrl+6" },
  { id: "focus.packages", title: "Show packages", section: "Window", keys: "⌃7", combo: "Ctrl+7" },
  { id: "focus.environment", title: "Show the environment", section: "Window", keys: "⌃8", combo: "Ctrl+8" },
  { id: "edit.pipe", title: "Insert pipe", section: "Edit", keys: "⇧⌘M", combo: "Shift+Mod+m" },
  { id: "edit.assign", title: "Insert assignment", section: "Edit", keys: "⌥−", combo: "Alt+-" },
  { id: "edit.section", title: "Insert section", section: "Edit", keys: "⇧⌘R", combo: "Shift+Mod+r" },
  { id: "help.atCursor", title: "R help for the name at the cursor", section: "Help", keys: "F1", combo: "F1" },
  { id: "data.import", title: "Import data", section: "File" },
  { id: "app.settings", title: "Settings", section: "App", keys: "⌘,", combo: "Mod+," },
  { id: "help.about", title: "License and version", section: "Help" },
  { id: "help.report", title: "Report a problem on GitHub", section: "Help" },
  { id: "assistant.show", title: "Show the assistant", section: "Assistant", keys: "⌃9", combo: "Ctrl+9" },
  { id: "assistant.explain", title: "Explain this code", section: "Assistant", keys: "⌥⌘E", combo: "Alt+Mod+e" },
  { id: "assistant.comment", title: "Add comments to this code", section: "Assistant" },
  { id: "assistant.improve", title: "Suggest a clearer version of this code", section: "Assistant" },
  { id: "assistant.write", title: "Write code from a description", section: "Assistant" },
  { id: "assistant.setup", title: "Set up the assistant and its models", section: "Assistant" },
];

/** Commands visible in the current layer. */
export function visibleCommands(layer: "essentials" | "everything"): Command[] {
  return COMMANDS.filter((command) => layer === "everything" || !command.advanced);
}

/**
 * Ranks commands for a palette query. Every word typed must appear in the
 * title or section, and titles starting with the query rank first, so
 * "run" puts "Run line" above "Restart R and run file".
 */
export function searchCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  const scored = commands
    .map((command) => {
      const text = `${command.title} ${command.section}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) return null;
      const score = command.title.toLowerCase().startsWith(words[0]) ? 0 : text.indexOf(words[0]) + 1;
      return { command, score };
    })
    .filter((item): item is { command: Command; score: number } => item !== null);
  return scored.sort((a, b) => a.score - b.score).map((item) => item.command);
}

/** Matches a key press against a combo such as "Shift+Mod+Enter". */
export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+");
  const key = parts[parts.length - 1].toLowerCase();
  const isMac = /Mac/.test(navigator.platform);
  const mod = parts.includes("Mod");
  const wantMeta = mod && isMac;
  const wantCtrl = parts.includes("Ctrl") || (mod && !isMac);
  // With Option held, a Mac reports a different character as the key, so
  // letters and digits are matched by their physical key code instead.
  const code = /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key === "-" ? "Minus" : "";
  const keyMatches = event.key.toLowerCase() === key || (code !== "" && event.code === code);
  return (
    keyMatches &&
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.shiftKey === parts.includes("Shift") &&
    event.altKey === parts.includes("Alt")
  );
}

/** True on a Mac, where shortcuts use the Command key and its symbols. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

const WORDS: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift", "↩": "Enter", "−": "-" };

/**
 * Shows a shortcut the way the computer's own keyboard labels it. The list
 * above is written in Mac symbols; Windows and Linux get words joined with
 * plus signs, in the usual Ctrl, Alt, Shift order.
 */
export function keyLabel(keys: string, mac = IS_MAC): string {
  if (mac) return keys;
  const order = ["⌃", "⌘", "⌥", "⇧"];
  const modifiers = order.filter((symbol) => keys.includes(symbol));
  const rest = [...keys].filter((symbol) => !order.includes(symbol)).join("");
  const names = [...new Set(modifiers.map((symbol) => WORDS[symbol]))];
  return [...names, WORDS[rest] ?? rest].join("+");
}
