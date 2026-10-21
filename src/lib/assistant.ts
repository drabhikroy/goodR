// The assistant's actions: setting it up, asking it things, and putting its
// code into the script. It is optional and stays off until the user sets
// it up, and everything it does runs on this computer through Ollama.
//
// Answers are suggestions. Code from the model is never run by the app.
// It goes into the script only when the user presses Insert or Replace,
// and R's own parser checks first whether it can read the code, so a
// broken suggestion is labeled before anyone relies on it.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { explainError } from "./errors";
import { referencedPackages } from "./packages";
import { statementAt, statementRanges } from "./statements";
export { codeBlocks, isOneOffStep, likeness } from "./suggestions";
import { getState, setState, type AssistantState, type AssistantTurn } from "./store";
import type { AnswerEvent, AssistantContext, AssistantTask, MachineSpecs, ModelCatalog, SetupEvent } from "./types";
import { historyToConsole, notify, openDialog, showPanel, updateSettings } from "./app";

let api: Backend;

// Changes the assistant's part of the state and leaves the rest alone, so a
// streaming answer does not re-render panes that do not show it.
function patch(change: Partial<AssistantState> | ((current: AssistantState) => Partial<AssistantState>)) {
  setState((state) => ({ assistant: { ...state.assistant, ...(typeof change === "function" ? change(state.assistant) : change) } }));
}

/** Listens for downloads and answers, and reconnects to the Ollama chosen
 * in an earlier session without holding up the app's start. */
export async function initAssistant(backend: Backend) {
  api = backend;
  await api.onAssistantSetup(onSetup);
  await api.onAssistantAnswer(onAnswer);
  const route = getState().settings.assistantRoute;
  if (route) connectAssistant(route, true).catch(() => {});
  else refreshAssistant().catch(() => {});
}

/** Reads what is on this computer and which models are installed, and
 * picks the model to use. */
export async function refreshAssistant() {
  const status = await api.assistantStatus();
  const installed = status.installed.map((model) => model.id);
  const wanted = getState().settings.assistantModel;
  const model = status.connected ? (installed.includes(wanted) ? wanted : installed[0] ?? "") : "";
  patch({ status, model });
  if (model && model !== wanted) updateSettings({ assistantModel: model });
  return status;
}

/** Connects to the system's Ollama or the private copy, starting it when
 * needed. `quiet` skips the notice, as when reconnecting at launch. */
export async function connectAssistant(route: "system" | "private", quiet = false) {
  patch({ connecting: true });
  try {
    await api.assistantConnect(route);
    updateSettings({ assistantRoute: route });
    await refreshAssistant();
    if (!quiet) notify(route === "private" ? "The private copy of Ollama is running." : "Connected to the Ollama on this computer.");
    return true;
  } catch (error) {
    if (!quiet) notify(String(error).replace(/^Error: /, ""), "error");
    await refreshAssistant().catch(() => {});
    return false;
  } finally {
    patch({ connecting: false });
  }
}

/** Downloads the private copy of Ollama, then connects to it. */
export async function installPrivateOllama() {
  try {
    await api.assistantInstallRuntime();
    return await connectAssistant("private");
  } catch (error) {
    notify(String(error).replace(/^Error: /, ""), "error");
    return false;
  }
}

export function cancelAssistantSetup() {
  api.assistantCancelSetup().catch(() => {});
}

/** Reads this computer's specs. Called only after the user agrees. */
export function readMachineSpecs(): Promise<MachineSpecs> {
  return api.assistantSpecs();
}

export function modelCatalog(specs: MachineSpecs | null): Promise<ModelCatalog> {
  return api.assistantCatalog(specs);
}

/** Downloads a model, and makes it the one in use when none is chosen. */
export async function downloadModel(id: string) {
  try {
    await api.assistantPull(id);
    await refreshAssistant();
    if (!getState().settings.assistantModel || !getState().assistant.model) chooseModel(id);
    notify(`${id} is ready to use.`);
    return true;
  } catch (error) {
    notify(String(error).replace(/^Error: /, ""), "error");
    return false;
  }
}

export async function removeModel(id: string) {
  const ok = await api.confirm(`Remove ${id} from this computer? It can be downloaded again later.`, "Remove");
  if (!ok) return;
  try {
    await api.assistantDelete(id);
    if (getState().settings.assistantModel === id) updateSettings({ assistantModel: "" });
    await refreshAssistant();
    notify(`Removed ${id}.`);
  } catch (error) {
    notify(String(error).replace(/^Error: /, ""), "error");
  }
}

/** Removes the private copy of Ollama and the models it holds. */
export async function removePrivateOllama() {
  const ok = await api.confirm("Remove the private copy of Ollama and every model it downloaded? The Ollama on this computer, if there is one, is not touched.", "Remove");
  if (!ok) return;
  try {
    await api.assistantRemoveRuntime();
    if (getState().settings.assistantRoute === "private") updateSettings({ assistantRoute: "", assistantModel: "" });
    await refreshAssistant();
    notify("The private copy of Ollama was removed.");
  } catch (error) {
    notify(String(error).replace(/^Error: /, ""), "error");
  }
}

// The choice is saved, so the same model answers after the app reopens.
export function chooseModel(id: string) {
  updateSettings({ assistantModel: id });
  patch({ model: id });
}

/** Opens the setup steps, after checking Ollama afresh, so a person
 * without it running starts at the first step rather than at a list of
 * models that cannot be reached. */
export async function openAssistantSetup() {
  await refreshAssistant().catch(() => patch({ status: null, model: "" }));
  openDialog("assistantSetup");
}

// A finished or failed step clears the progress bar. The outcome itself
// arrives through the command that started the step.
function onSetup(event: SetupEvent) {
  patch({ setup: event.done ? null : event });
}

// Answers that go somewhere other than the conversation, such as a draft
// in the script, by request id.
const answerListeners = new Map<string, (event: AnswerEvent) => void>();

function onAnswer(event: AnswerEvent) {
  const listener = answerListeners.get(event.id);
  if (listener) {
    listener(event);
    if (event.done) answerListeners.delete(event.id);
    return;
  }
  patch((current) => ({
    turns: current.turns.map((turn) =>
      turn.id === event.id ? { ...turn, text: turn.text + event.text, done: event.done, error: event.error ? event.error.replace(/^Error: /, "") : turn.error } : turn,
    ),
    answering: event.done && current.answering === event.id ? null : current.answering,
  }));
}

/** What the model is told about the session: names, never values. */
function context(): AssistantContext {
  const { r, objects, active } = getState();
  const text = active && !active.startsWith("data:") ? editor.getText(active) : "";
  return {
    rVersion: r.version,
    objects: objects.map((object) => `${object.name} (${object.class})${object.columns.length ? `: ${object.columns.slice(0, 30).join(", ")}` : ""}`),
    packages: referencedPackages(text).map((reference) => reference.name),
  };
}

/** Sends a request and streams the answer into the conversation. */
export async function askAssistant(task: AssistantTask, label: string, replace: AssistantTurn["replace"] = null) {
  const { model, answering } = getState().assistant;
  if (!model) {
    openAssistantSetup();
    return;
  }
  if (answering) {
    notify("The assistant is still answering. Stop it first, or wait for it to finish.");
    return;
  }
  showPanel("assistant");
  const id = crypto.randomUUID();
  // Earlier turns give a follow up question its background. Failed or
  // stopped answers are left out, since they would only confuse the model.
  const history = getState()
    .assistant.turns.filter((turn) => turn.done && !turn.error && turn.text)
    .map((turn) => ({ role: turn.role, content: turn.text }));
  const question: AssistantTurn = { id: `${id}-q`, role: "user", label, text: task.kind === "ask" ? task.question : task.kind === "writeCode" ? task.request : label, done: true, error: "", replace: null };
  const answer: AssistantTurn = { id, role: "assistant", label, text: "", done: false, error: "", replace };
  patch((current) => ({ turns: [...current.turns, question, answer], answering: id }));
  try {
    await api.assistantAsk(id, model, task, context(), history);
  } catch (error) {
    // The answer event usually carries the error. This covers a call that
    // failed before any event was sent.
    patch((current) => ({
      turns: current.turns.map((turn) => (turn.id === id && !turn.done ? { ...turn, done: true, error: String(error).replace(/^Error: /, "") } : turn)),
      answering: current.answering === id ? null : current.answering,
    }));
  }
}

/**
 * Asks the assistant for code outside the conversation, handing each piece
 * of the answer to `onText` as it arrives and the outcome to `onDone`.
 * Returns false when no model is set up, after opening the setup.
 */
export async function askForCode(request: string, onText: (text: string) => void, onDone: (error: string) => void): Promise<boolean> {
  const { model } = getState().assistant;
  if (!model) {
    notify("Set up the assistant first. It runs on this computer and takes a few minutes.");
    openAssistantSetup();
    return false;
  }
  const id = crypto.randomUUID();
  answerListeners.set(id, (event) => {
    if (event.text) onText(event.text);
    if (event.done) onDone(event.error ? event.error.replace(/^Error: /, "") : "");
  });
  try {
    await api.assistantAsk(id, model, { kind: "writeCode", request }, context(), []);
  } catch (error) {
    answerListeners.delete(id);
    onDone(String(error).replace(/^Error: /, ""));
  }
  return true;
}

export function stopAnswer() {
  api.assistantStop().catch(() => {});
}

export function clearConversation() {
  if (getState().assistant.answering) stopAnswer();
  patch({ turns: [], answering: null });
}

/** The selected code, or the statement under the cursor when nothing is
 * selected, with the lines it covers. */
export function codeAtCursor(): { file: string; code: string; from: number; to: number } | null {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return null;
  const position = editor.cursor(active);
  const text = editor.getText(active);
  if (position.selection.trim()) {
    const lines = text.split("\n");
    const from = Math.max(0, position.selectionEndLine - position.selection.split("\n").length + 1);
    const to = Math.min(position.selectionEndLine, lines.length - 1);
    // A selection that starts or ends partway through a line is widened
    // to whole lines, so a replacement never cuts a line in two.
    return { file: active, code: lines.slice(from, to + 1).join("\n"), from, to };
  }
  const range = statementAt(statementRanges(text), position.line);
  if (!range) return null;
  return { file: active, code: text.split("\n").slice(range.from, range.to + 1).join("\n"), from: range.from, to: range.to };
}

// Line numbers in labels count from one, as the editor's gutter does.
function linesLabel(from: number, to: number) {
  return from === to ? `line ${from + 1}` : `lines ${from + 1} to ${to + 1}`;
}

/** Explains, comments, or improves the code at the cursor. */
export function assistOnCode(kind: "explainCode" | "comment" | "improve") {
  const target = codeAtCursor();
  if (!target) {
    notify("Put the cursor on some code, or select it, first.");
    return;
  }
  const where = linesLabel(target.from, target.to);
  const label = kind === "explainCode" ? `Explain ${where}` : kind === "comment" ? `Add comments to ${where}` : `Suggest a clearer ${where}`;
  // Explaining changes nothing, so only the other two offer Replace.
  const replace = kind === "explainCode" ? null : target;
  askAssistant({ kind, code: target.code }, label, replace);
}

/** Asks why a statement failed, with the plain explanation as a start. */
export function askAssistantAboutError(blockId: string) {
  const block = getState().blocks[blockId];
  if (!block) return;
  const error = block.items.find((item) => item.type === "error");
  if (!error || error.type !== "error") return;
  const plain = explainError(error.message, getState().objects, block.code, error.traceback, error.parsed ?? "");
  const line = editor.blockLines(block.file).get(blockId) ?? block.toLine;
  const from = line - (block.toLine - block.fromLine);
  askAssistant(
    { kind: "explainError", code: block.code, message: plain.original, plain: `${plain.title}. ${plain.detail}` },
    `Why ${linesLabel(from, line)} did not run`,
    { file: block.file, code: block.code, from, to: line },
  );
}

/** Whether R's parser can read some code, without running it. */
export async function checkCode(code: string): Promise<"complete" | "incomplete" | "invalid" | "unknown"> {
  if (getState().r.status !== "ready") return "unknown";
  const status = await api.isComplete(getState().activeSession, code).catch(() => "unknown");
  return status === "complete" || status === "incomplete" || status === "invalid" ? status : "unknown";
}

/** Puts an answer's code in the console's typing box, to read and run
 * there. It suits one off steps, such as installing a package, that do not
 * belong in the script. Nothing runs until the user presses Return. */
export function codeToConsole(code: string) {
  historyToConsole(code);
}

/** Types an answer's code at the cursor in the script, as if typed there. */
export function insertAssistantCode(code: string) {
  const { active } = getState();
  if (!active || active.startsWith("data:")) {
    notify("Open a script first, then insert the code.");
    return;
  }
  const blank = editor.cursorLineIsBlank();
  editor.insertAtCursor(blank ? `${code}\n` : `\n${code}\n`);
}

/**
 * Puts an answer's code in place of the code it was about. If those lines
 * changed since the question, the code goes in at the cursor instead, so
 * newer edits are never overwritten.
 */
export function replaceWithAssistantCode(turn: AssistantTurn, code: string) {
  const target = turn.replace;
  if (!target) return insertAssistantCode(code);
  const now = editor.getText(target.file).split("\n").slice(target.from, target.to + 1).join("\n");
  if (now !== target.code) {
    notify("Those lines changed since you asked, so the code went in at the cursor instead.");
    return insertAssistantCode(code);
  }
  editor.replaceLines(target.file, target.from, target.to, code);
  notify(`Replaced ${linesLabel(target.from, target.to)}. Undo puts the old code back.`);
}
