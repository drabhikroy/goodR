// Explaining a line of R without the assistant.
//
// A line such as  big <- subset(meteorites, mass_g > 1000)  does three
// things in an order that is not left to right as it reads: subset runs,
// with its comparison worked out first, and the result is stored as big.
// This reads the line and says that, in order: each function as R
// finishes it, innermost first, and then where the result goes. The words
// for each function come from the title of its help page, read by R when
// it is free, so the explanation is R's own and needs no model.
//
// It depends on nothing but the tokenizer, so it can be tested alone.

import { tokenize } from "./shinyCheck";

/** What a line does: the functions it calls, in the order R finishes
 * them, and the name its result is stored as, if any. */
export type LineSteps = { calls: string[]; assigns: string | null; pipes: boolean };

export function lineSteps(code: string): LineSteps {
  const tokens = tokenize(code);
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  let assigns: string | null = null;
  // name <- ..., name = ... at the start, or ... -> name at the end.
  if (tokens[0]?.kind === "ident" && (isOp(1, "<-") || isOp(1, "=") || isOp(1, "<<-"))) assigns = tokens[0].text;
  const last = tokens.length - 1;
  if (!assigns && tokens[last]?.kind === "ident" && (isOp(last - 1, "->") || isOp(last - 1, "->>"))) assigns = tokens[last].text;
  // Each call is finished when its closing bracket is reached, so calls
  // are listed in the order their brackets close.
  const open: { name: string | null }[] = [];
  const calls: string[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    if (isOp(k, "(")) {
      const name = tokens[k - 1]?.kind === "ident" && !isOp(k - 2, "$") ? tokens[k - 1].text : null;
      const qualified = name && isOp(k - 2, "::") && tokens[k - 3]?.kind === "ident" ? `${tokens[k - 3].text}::${name}` : name;
      open.push({ name: name === "function" ? null : qualified });
    } else if (isOp(k, ")")) {
      const call = open.pop();
      if (call?.name && !calls.includes(call.name)) calls.push(call.name);
    }
  }
  // The tokenizer reads %>% as three marks, so pipes are found in the
  // code with its text and comments masked.
  const pipes = /\|>|%>%/.test(tokens.filter((token) => token.kind === "op").map((token) => token.text).join(""));
  return { calls, assigns, pipes };
}
