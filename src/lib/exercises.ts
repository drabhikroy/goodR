// Exercises made from a script, for teaching.
//
// A teacher writes the script as usual and marks the lines students should
// write themselves, with a comment above each: what to do, and a hint.
//
//   # exercise: Keep only the penguins heavier than 4 kg.
//   # hint: subset() takes the data and a condition.
//   heavy <- subset(penguins, body_mass > 4000)
//
// Saving it for students replaces each marked line with a blank, keeping
// the name it assigns, and stores the answer under the comments, encoded
// so it is not read by accident while working:
//
//   # exercise: Keep only the penguins heavier than 4 kg.
//   # hint: subset() takes the data and a condition.
//   # answer: aGVhdnkgPC0gc3Vic2V0KC4uLik=
//   heavy <- ___
//
// When a student runs that line, R compares the result with the answer's,
// so any correct way of writing it counts, not just the teacher's.
//
// The reading and writing of these comments is here, apart from the
// interface, so it can be tested alone.

import { statementAt, statementRanges } from "./statements";

/** One exercise: its number, counting from one, what to do, the hint, the
 * answer, and the lines of the statement the student writes. */
export type Exercise = { number: number; task: string; hint: string; answer: string; from: number; to: number };

const TASK = /^\s*#\s*exercise:\s*(.*)$/i;
const HINT = /^\s*#\s*hint:\s*(.*)$/i;
const ANSWER = /^\s*#\s*answer:\s*(\S*)\s*$/i;

/** Text to base64 and back, keeping any letter, not only plain ASCII. */
export function encodeAnswer(text: string) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeAnswer(encoded: string) {
  try {
    const binary = atob(encoded);
    return new TextDecoder().decode(Uint8Array.from(binary, (letter) => letter.charCodeAt(0)));
  } catch {
    return "";
  }
}

/** The exercises in a script, each with the statement right after its
 * comments. In a teacher's script, the answer is that statement. In a
 * student's copy, it is the encoded answer comment. */
export function readExercises(text: string): Exercise[] {
  const lines = text.split("\n");
  const ranges = statementRanges(text);
  const found: Exercise[] = [];
  for (let k = 0; k < lines.length; k += 1) {
    const task = TASK.exec(lines[k]);
    if (!task) continue;
    let hint = "";
    let encoded: string | null = null;
    let next = k + 1;
    for (; next < lines.length; next += 1) {
      const hinted = HINT.exec(lines[next]);
      const answered = ANSWER.exec(lines[next]);
      if (hinted) hint = hinted[1].trim();
      else if (answered) encoded = answered[1];
      else break;
    }
    const range = statementAt(ranges, next);
    if (!range || range.from !== next) continue;
    const answer = encoded !== null ? decodeAnswer(encoded) : lines.slice(range.from, range.to + 1).join("\n");
    found.push({ number: found.length + 1, task: task[1].trim(), hint, answer, from: range.from, to: range.to });
    k = range.to;
  }
  return found;
}

/** Whether a script is a student's copy, with answers stored in it. */
export function isStudentCopy(text: string) {
  return text.split("\n").some((line) => ANSWER.test(line));
}

/** The blank a student starts from: the name the answer assigns, when it
 * assigns one, and three underscores to fill in. */
export function blankFor(answer: string) {
  const assigned = /^\s*([A-Za-z.][\w.]*)\s*(<-|=)/.exec(answer);
  return assigned ? `${assigned[1]} ${assigned[2]} ___` : "___";
}

/** The student's copy of a teacher's script: each exercise's statement
 * replaced by its blank, with the answer stored above it. */
export function studentCopy(text: string): string {
  const lines = text.split("\n");
  const exercises = readExercises(text);
  for (const exercise of [...exercises].reverse()) {
    lines.splice(exercise.from, exercise.to - exercise.from + 1, `# answer: ${encodeAnswer(exercise.answer)}`, blankFor(exercise.answer));
  }
  return lines.join("\n");
}

/** The exercise whose statement covers a line, if any. */
export function exerciseAt(exercises: Exercise[], line: number) {
  return exercises.find((exercise) => line >= exercise.from && line <= exercise.to) ?? null;
}
