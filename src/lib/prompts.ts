/**
 * What R is waiting for when it stops to ask a question at the prompt. R
 * words some of these for people who know it well, so the question is
 * shown in full, with plain buttons for the answers it accepts and, for the
 * questions people meet most, a sentence on what each answer means.
 */
export interface PromptHelp {
  /** The words to send for each button, in the order R lists them. */
  choices: string[];
  /** What the question is about, or null when there is nothing to add. */
  explanation: string | null;
}

// R writes a choice as (yes/No/cancel), (y/n), or [y/n], with the default
// answer in capitals.
const CHOICES = /[([]\s*(y(?:es)?)\s*\/\s*(n(?:o)?)(?:\s*\/\s*(c(?:ancel)?))?\s*[)\]]/i;

const PERSONAL_LIBRARY =
  "R keeps its packages in a library. The main one belongs to the whole computer, and your account may not be allowed to add to it. A personal library is a folder in your own home folder that only you use. Answering Yes makes one, and every package you install goes there. It is the usual choice.";

export function describePrompt(prompt: string): PromptHelp {
  const found = CHOICES.exec(prompt);
  const choices = found ? ["yes", "no", ...(found[3] ? ["cancel"] : [])] : [];
  const explanation = /personal library/i.test(prompt) ? PERSONAL_LIBRARY : null;
  return { choices, explanation };
}
