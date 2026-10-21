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
  // Option Command C is RStudio's Run Current Chunk. In a script it runs
  // the section the cursor is in.
  { id: "run.chunk", title: "Run chunk or section", section: "Run", keys: "⌥⌘C", combo: "Alt+Mod+c" },
  { id: "run.toHere", title: "Run to here", section: "Run", keys: "⌥⌘B", combo: "Alt+Mod+b", advanced: true },
  { id: "run.stop", title: "Stop", section: "Run", keys: "⌘.", combo: "Mod+." },
  // Command Z undoes typing in the script. Undoing a run is a different
  // thing, so it has its own shortcut, one key away.
  { id: "run.undo", title: "Undo the last run", section: "Run", keys: "⌥⌘Z", combo: "Alt+Mod+z" },
  { id: "run.restart", title: "Restart R", section: "Run", keys: "⇧⌘0", combo: "Shift+Mod+0" },
  { id: "run.restartRunAll", title: "Restart R and run file", section: "Run", advanced: true },
  { id: "run.fresh", title: "Check it runs from scratch", section: "Run" },
  { id: "run.chooseR", title: "Choose R version", section: "Run" },
  { id: "run.clearOutput", title: "Clear output", section: "Run" },
  { id: "run.clearConsole", title: "Clear all results", section: "Run", keys: "⌘L", combo: "Mod+l" },
  { id: "render.report", title: "Render report", section: "Run", keys: "⇧⌘K", combo: "Shift+Mod+k" },
  { id: "render.html", title: "Render report as HTML", section: "Run", advanced: true },
  { id: "render.word", title: "Render report as Word", section: "Run", advanced: true },
  { id: "render.pdf", title: "Render report as PDF", section: "Run", advanced: true },
  { id: "render.stop", title: "Stop rendering", section: "Run" },
  // Run app has no shortcut of its own. RStudio gives it Shift Command
  // Return, which here always runs the whole file, wherever the file is.
  { id: "app.run", title: "Run Shiny app", section: "Run" },
  { id: "app.stop", title: "Stop Shiny app", section: "Run" },
  { id: "app.open", title: "Open Shiny app in the browser", section: "Run", advanced: true },
  { id: "app.share", title: "Share Shiny app as a web page", section: "Run" },
  { id: "file.new", title: "New script", section: "File", keys: "⌘N", combo: "Mod+n" },
  { id: "file.newDocument", title: "New Quarto or R Markdown document", section: "File", keys: "⌥⌘N", combo: "Alt+Mod+n" },
  { id: "file.newShinyApp", title: "New Shiny app", section: "File" },
  { id: "file.open", title: "Open script", section: "File", keys: "⌘O", combo: "Mod+o" },
  { id: "project.new", title: "New project", section: "File", keys: "⇧⌘N", combo: "Shift+Mod+n" },
  { id: "project.open", title: "Open project", section: "File", keys: "⇧⌘O", combo: "Shift+Mod+o" },
  { id: "project.close", title: "Close project", section: "File" },
  { id: "file.save", title: "Save", section: "File", keys: "⌘S", combo: "Mod+s" },
  { id: "file.saveAs", title: "Save as", section: "File", keys: "⇧⌘S", combo: "Shift+Mod+s" },
  { id: "file.history", title: "Earlier versions of this file", section: "File" },
  { id: "file.saveAll", title: "Save all", section: "File", keys: "⌥⌘S", combo: "Alt+Mod+s" },
  { id: "file.exportPlot", title: "Export plot", section: "File", keys: "⇧⌘E", combo: "Shift+Mod+e" },
  { id: "file.saveExercises", title: "Save as exercises for students", section: "File" },
  { id: "results.report", title: "Save results as a report", section: "File" },
  { id: "file.close", title: "Close tab", section: "File", keys: "⌘W", combo: "Mod+w" },
  { id: "edit.find", title: "Find and replace", section: "Edit", keys: "⌘F" },
  { id: "edit.findInFiles", title: "Find in all files", section: "Edit", keys: "⇧⌘F", combo: "Shift+Mod+f" },
  { id: "edit.comment", title: "Comment lines", section: "Edit", keys: "⇧⌘C", combo: "Shift+Mod+c" },
  { id: "edit.rename", title: "Rename everywhere in this file", section: "Edit", keys: "F2", combo: "F2" },
  { id: "edit.tidy", title: "Tidy up my code", section: "Edit", keys: "⇧⌘A", combo: "Shift+Mod+a" },
  { id: "edit.fixProblems", title: "Fix problems in this script", section: "Edit" },
  { id: "edit.makeExercise", title: "Make this line an exercise", section: "Edit" },
  { id: "edit.trace", title: "Where did this come from?", section: "Edit" },
  { id: "edit.explain", title: "What does this code do?", section: "Edit", keys: "⌥⌘E", combo: "Alt+Mod+e" },
  { id: "view.output.canvas", title: "Show results in the canvas", section: "View", keys: "⌥⌘1", combo: "Alt+Mod+1" },
  { id: "view.output.inline", title: "Show results under each line", section: "View", keys: "⌥⌘2", combo: "Alt+Mod+2" },
  { id: "view.style.cards", title: "Show results as cards", section: "View" },
  { id: "view.style.plain", title: "Show results as plain text", section: "View" },
  { id: "view.live", title: "Update results as you type", section: "View", keys: "⌥⌘L", combo: "Alt+Mod+l" },
  { id: "view.sidebar", title: "Show or hide the sidebar", section: "View", keys: "⌃⌘S" },
  { id: "view.history", title: "Show past commands", section: "View", keys: "⇧⌘Y", combo: "Shift+Mod+y" },
  { id: "view.inspector", title: "Show or hide the canvas", section: "View", keys: "⌥⌘0", combo: "Alt+Mod+0" },
  { id: "view.prompt", title: "Show or hide the R prompt", section: "View" },
  { id: "view.timeline", title: "Show or hide earlier results", section: "View" },
  { id: "view.resetLayout", title: "Reset the layout", section: "View" },
  { id: "view.startScreen", title: "Show the start screen", section: "View", keys: "⇧⌘H", combo: "Shift+Mod+h" },
  { id: "view.focus", title: "Focus on the script and the result", section: "View", keys: "⌥⌘F", combo: "Alt+Mod+f" },
  { id: "view.layer.essentials", title: "Use the Essentials menus", section: "View" },
  { id: "view.layer.everything", title: "Use the Everything menus", section: "View" },
  { id: "view.zoomIn", title: "Larger text", section: "View", keys: "⌘=", combo: "Mod+=" },
  { id: "view.zoomOut", title: "Smaller text", section: "View", keys: "⌘−", combo: "Mod+-" },
  { id: "packages.install", title: "Install packages", section: "Packages" },
  { id: "packages.checkUpdates", title: "Check for package updates", section: "Packages" },
  { id: "packages.updateAll", title: "Update all packages", section: "Packages" },
  { id: "packages.installMissing", title: "Install missing packages for this file", section: "Packages" },
  { id: "packages.auto", title: "Install missing packages automatically", section: "Packages" },
  { id: "focus.editor", title: "Move to the editor", section: "Window", keys: "⌃1", combo: "Ctrl+1" },
  { id: "focus.console", title: "Move to the R prompt", section: "Window", keys: "⌃2", combo: "Ctrl+2" },
  { id: "focus.help", title: "Look something up in R help", section: "Window", keys: "⌃3", combo: "Ctrl+3" },
  { id: "focus.history", title: "Move to past commands", section: "Window", keys: "⌃4", combo: "Ctrl+4" },
  { id: "focus.plots", title: "Move to the canvas", section: "Window", keys: "⌃6", combo: "Ctrl+6" },
  { id: "focus.packages", title: "Move to packages", section: "Window", keys: "⌃7", combo: "Ctrl+7" },
  { id: "focus.environment", title: "Move to the objects in R", section: "Window", keys: "⌃8", combo: "Ctrl+8" },
  { id: "edit.pipe", title: "Insert pipe", section: "Edit", keys: "⇧⌘M", combo: "Shift+Mod+m" },
  { id: "edit.assign", title: "Insert assignment", section: "Edit", keys: "⌥−", combo: "Alt+-" },
  { id: "edit.section", title: "Insert section", section: "Edit", keys: "⇧⌘R", combo: "Shift+Mod+r" },
  // Option Command I is RStudio's Insert Chunk.
  { id: "edit.chunk", title: "Insert chunk", section: "Edit", keys: "⌥⌘I", combo: "Alt+Mod+i" },
  { id: "edit.cite", title: "Insert citation", section: "Edit" },
  { id: "help.atCursor", title: "R help for the name at the cursor", section: "Help", keys: "F1", combo: "F1" },
  { id: "data.import", title: "Import data", section: "File" },
  { id: "app.settings", title: "Settings", section: "App", keys: "⌘,", combo: "Mod+," },
  { id: "app.updates", title: "Check for updates", section: "App" },
  { id: "app.reset", title: "Reset the app", section: "App" },
  { id: "help.guide", title: "Help for this app", section: "Help", keys: "⇧⌘/", combo: "Shift+Mod+/" },
  { id: "help.examples", title: "Open the example project", section: "Help" },
  { id: "help.tour", title: "Take the tour", section: "Help" },
  { id: "help.firstProject", title: "Do a first project, step by step", section: "Help" },
  { id: "help.about", title: "License and version", section: "Help" },
  { id: "help.report", title: "Report a problem on GitHub", section: "Help" },
  { id: "assistant.show", title: "Show the assistant", section: "Assistant", keys: "⌃9", combo: "Ctrl+9" },
  { id: "assistant.explain", title: "Ask the assistant to explain this code", section: "Assistant" },
  { id: "assistant.comment", title: "Add comments to this code", section: "Assistant" },
  { id: "assistant.improve", title: "Suggest a clearer version of this code", section: "Assistant" },
  { id: "assistant.writeHere", title: "Write code for this comment", section: "Assistant", keys: "⌥⌘G", combo: "Alt+Mod+g" },
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
  // Control Command S on a Mac would read as Ctrl+S, the save shortcut,
  // elsewhere, so the sidebar uses Ctrl+B there, as the menu does.
  if (keys === "⌃⌘S") return "Ctrl+B";
  const order = ["⌃", "⌘", "⌥", "⇧"];
  const modifiers = order.filter((symbol) => keys.includes(symbol));
  const rest = [...keys].filter((symbol) => !order.includes(symbol)).join("");
  const names = [...new Set(modifiers.map((symbol) => WORDS[symbol]))];
  return [...names, WORDS[rest] ?? rest].join("+");
}

/**
 * Ready made code that matches a palette query, as Insert entries. They
 * show only once something is typed, so the full command list stays as
 * it was, and typing "insert" lists them all.
 */
export function searchSnippets(snippets: { id: string; title: string; words: string }[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return snippets
    .filter((item) => words.every((word) => `insert ${item.title} ${item.words}`.toLowerCase().includes(word)))
    .map((item) => ({ id: `snippet:${item.id}`, title: `Insert: ${item.title}`, section: "Insert" }));
}
