// The check of an exercise, under the student's result: right, not yet
// with what differs, or a note that it cannot be checked. Help comes in
// steps, so trying comes first: the hint after the first miss, and the
// answer once two attempts have missed.

import { useState } from "react";
import { showAnswer, exerciseFor } from "../lib/teaching";
import { useStore, type Block } from "../lib/store";
import { CheckIcon, HollowIcon, WarnIcon } from "./Icons";

export function ExerciseResult({ block }: { block: Block }) {
  const verdict = block.exercise!;
  const attempts = useStore((state) => state.exerciseProgress[block.file]?.attempts[verdict.number] ?? 0);
  const [hint, setHint] = useState(false);
  const exercise = exerciseFor(block);
  return (
    <section className={`exercise-result ${verdict.ok ? "is-right" : verdict.ok === false ? "is-not-yet" : ""}`} aria-label={`Exercise ${verdict.number}`} role="status">
      <p className="exercise-verdict">
        {verdict.ok ? <CheckIcon size={16} label="Right" /> : verdict.ok === false ? <WarnIcon size={16} /> : <HollowIcon size={16} />}
        <strong>{verdict.ok ? `Exercise ${verdict.number}: right` : verdict.ok === false ? `Exercise ${verdict.number}: not yet` : `Exercise ${verdict.number}`}</strong>
      </p>
      {verdict.message && <p>{verdict.message}</p>}
      {verdict.ok === false && exercise && (
        <div className="button-row">
          {exercise.hint && !hint && (
            <button type="button" className="button small" onClick={() => setHint(true)}>
              Show the hint
            </button>
          )}
          {attempts >= 2 && (
            <button type="button" className="button small quiet" onClick={() => showAnswer(block)}>
              Show the answer
            </button>
          )}
        </div>
      )}
      {hint && exercise?.hint && <p className="exercise-hint">Hint: {exercise.hint}</p>}
    </section>
  );
}
