// Teaching with exercises: the actions behind the teacher's two commands
// and the check that runs when a student runs an exercise's line.
//
// The format of the comments is in exercises.ts. This file adds them to a
// script, saves the student's copy, asks R to check each attempt, and keeps
// count of attempts and of exercises done, for the bar above the script.

import type { Backend } from "./backend";
import * as editor from "./editor";
import { baseName, notify, openFile } from "./app";
import { exerciseAt, isStudentCopy, readExercises, studentCopy } from "./exercises";
import { statementAt, statementRanges } from "./statements";
import { getState, setState, updateBlock, type Block } from "./store";

let api: Backend;

export function initTeaching(backend: Backend) {
  api = backend;
}

const TASK_PLACEHOLDER = "Say what to do here.";

/** Marks the statement at the cursor as an exercise, with its task text
 * selected, ready to type over. */
export function makeExercise() {
  const { active } = getState();
  if (!active || active.startsWith("data:")) return;
  const text = editor.getText(active);
  if (isStudentCopy(text)) return notify("This is already a copy for students. Make exercises in the original script.");
  const range = statementAt(statementRanges(text), editor.cursor(active).line);
  if (!range) return notify("Put the cursor on a line of code to make it an exercise.");
  const lines = text.split("\n");
  if (/^\s*#\s*(exercise|hint):/i.test(lines[range.from - 1] ?? "")) return notify("This line is already an exercise.");
  const at = lines.slice(0, range.from).reduce((sum, line) => sum + line.length + 1, 0);
  editor.replaceSpan(active, at, at, `# exercise: ${TASK_PLACEHOLDER}\n# hint: A hint for anyone stuck, or delete this line.\n`);
  // The task's words are selected once the menu or search that ran this
  // has closed and given focus back, so typing replaces them.
  setTimeout(() => editor.selectSpan(active, range.from, TASK_PLACEHOLDER, 0), 30);
}

/** Saves the copy for students beside the script, and opens it. */
export async function saveExercises() {
  const { active, tabs } = getState();
  const tab = tabs.find((item) => item.path === active);
  if (!active || !tab || tab.kind === "data") return;
  const text = editor.getText(active);
  if (isStudentCopy(text)) return notify("This is already a copy for students.");
  const exercises = readExercises(text);
  if (!exercises.length) return notify("There are no exercises in this script yet. Put the cursor on a line and choose Make this line an exercise.");
  const name = tab.untitled ? "exercises.R" : baseName(active).replace(/(\.[^.]+)?$/, (extension) => `-exercises${extension || ".R"}`);
  const path = await api.chooseSavePath(name).catch(() => null);
  if (!path) return;
  try {
    await api.writeText(path, studentCopy(text));
  } catch (error) {
    return notify(String(error), "error");
  }
  await openFile(path);
  notify(`Saved ${exercises.length} ${exercises.length === 1 ? "exercise" : "exercises"} for students. Each one is a blank to fill in, checked when it runs.`);
}

/** Attempts and exercises done, by file, for the bar above the script. */
export type ExerciseProgress = { done: number[]; attempts: Record<number, number> };

function recordAttempt(path: string, number: number, ok: boolean | null) {
  setState((state) => {
    const before = state.exerciseProgress[path] ?? { done: [], attempts: {} };
    const attempts = { ...before.attempts, [number]: (before.attempts[number] ?? 0) + 1 };
    const done = ok && !before.done.includes(number) ? [...before.done, number] : before.done;
    return { exerciseProgress: { ...state.exerciseProgress, [path]: { done, attempts } } };
  });
}

/** After a statement finishes in a student's copy, checks it when it is an
 * exercise, and puts the verdict on its result. */
export function checkExercise(session: string, block: Block) {
  if (block.live) return;
  const text = editor.getText(block.file);
  if (!isStudentCopy(text)) return;
  const exercise = exerciseAt(readExercises(text), block.fromLine);
  if (!exercise) return;
  const verdict = (ok: boolean | null, message: string) => {
    recordAttempt(block.file, exercise.number, ok);
    if (getState().blocks[block.id]) updateBlock(block.id, { exercise: { number: exercise.number, ok, message } });
  };
  if (block.code.includes("___")) return verdict(false, "Replace ___ with your code, then run the line again.");
  if (block.status === "error") return verdict(false, "The line did not run. The explanation above says why. Fix it and run it again.");
  if (block.status !== "ok") return;
  api
    .exercise(session, block.code, exercise.answer)
    .then((result) => verdict(result.ok, result.message))
    .catch(() => {});
}

/** The exercise a result belongs to, with what it needs for its hint and
 * its answer. */
export function exerciseFor(block: Block) {
  return exerciseAt(readExercises(editor.getText(block.file)), block.fromLine);
}

/** Puts the answer in place of the student's line, after they have tried. */
export function showAnswer(block: Block) {
  const exercise = exerciseFor(block);
  if (!exercise) return;
  editor.replaceLines(block.file, exercise.from, exercise.to, exercise.answer);
  notify("The answer is in the script. Run the line to see what it makes.");
}
