import { describe, expect, it } from "vitest";
import { blankFor, decodeAnswer, encodeAnswer, exerciseAt, isStudentCopy, readExercises, studentCopy } from "../../src/lib/exercises";

const TEACHER = [
  "data(penguins)",
  "# exercise: Keep only the penguins heavier than 4 kg.",
  "# hint: subset() takes the data and a condition.",
  "heavy <- subset(penguins,",
  "                body_mass > 4000)",
  "# exercise: Count them.",
  "nrow(heavy)",
].join("\n");

describe("exercises", () => {
  it("reads each exercise and its answer from a teacher's script", () => {
    const exercises = readExercises(TEACHER);
    expect(exercises.map((item) => [item.number, item.task, item.hint, item.from, item.to])).toEqual([
      [1, "Keep only the penguins heavier than 4 kg.", "subset() takes the data and a condition.", 3, 4],
      [2, "Count them.", "", 6, 6],
    ]);
    expect(exercises[0].answer).toBe("heavy <- subset(penguins,\n                body_mass > 4000)");
  });

  it("writes a student's copy with blanks, and reads the answers back from it", () => {
    const copy = studentCopy(TEACHER);
    expect(copy).toContain("heavy <- ___");
    expect(copy).not.toContain("body_mass > 4000");
    expect(isStudentCopy(copy)).toBe(true);
    const exercises = readExercises(copy);
    expect(exercises[0].answer).toBe("heavy <- subset(penguins,\n                body_mass > 4000)");
    expect(exercises[1].answer).toBe("nrow(heavy)");
    expect(exerciseAt(exercises, exercises[1].from)?.number).toBe(2);
  });

  it("keeps any letter through the encoding, and makes blanks that keep the name", () => {
    expect(decodeAnswer(encodeAnswer('cat("naïve")'))).toBe('cat("naïve")');
    expect(blankFor("fit <- lm(y ~ x)")).toBe("fit <- ___");
    expect(blankFor("summary(fit)")).toBe("___");
  });
});
