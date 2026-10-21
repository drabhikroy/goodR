// Code that still runs but has been retired, and what replaced it.
//
// Packages change their minds: dplyr's _each and underscore verbs gave way
// to across(), tidyr's gather() to pivot_longer(), ggplot2's size for lines
// to linewidth. Old code keeps working for a while, with a warning, then
// stops. Updating it by hand means knowing what each warning wants. This
// reads a script for the common cases, and also reads the deprecation
// warnings R printed when it ran, which name the old and the new for any
// package that follows the tidyverse's wording.
//
// A fix is offered only when the new form takes the same arguments, so
// applying it cannot change what the code does. The rest are listed with
// what to use instead, for the user to change.

import { tokenize } from "./shinyCheck";
import type { Hint } from "./hints";

type Token = ReturnType<typeof tokenize>[number];

/** Functions with a drop in replacement: same arguments, new name. */
const RENAMED: Record<string, { to: string; pkg: string }> = {
  data_frame: { to: "tibble", pkg: "tibble" },
  as_data_frame: { to: "as_tibble", pkg: "tibble" },
  add_rownames: { to: "rownames_to_column", pkg: "tibble" },
  rbind_all: { to: "bind_rows", pkg: "dplyr" },
  rbind_list: { to: "bind_rows", pkg: "dplyr" },
  stat: { to: "after_stat", pkg: "ggplot2" },
};

/** Functions whose replacement takes different arguments, with what to
 * use instead, in a few words. */
const RETIRED: Record<string, string> = {
  gather: "pivot_longer() replaced gather(). It names the new columns with names_to and values_to.",
  spread: "pivot_wider() replaced spread(). It takes names_from and values_from.",
  mutate_each: "mutate(across()) replaced mutate_each().",
  summarise_each: "summarise(across()) replaced summarise_each().", // standards: dplyr's own name
  summarize_each: "summarize(across()) replaced summarize_each().",
  mutate_at: "mutate(across()) replaced mutate_at().",
  mutate_if: "mutate(across(where())) replaced mutate_if().",
  mutate_all: "mutate(across(everything())) replaced mutate_all().",
  summarise_at: "summarise(across()) replaced summarise_at().", // standards: dplyr's own name
  summarise_if: "summarise(across(where())) replaced summarise_if().", // standards: dplyr's own name
  summarise_all: "summarise(across(everything())) replaced summarise_all().", // standards: dplyr's own name
  funs: "funs() is retired. Pass a function, or a list of functions, to across() instead.",
  top_n: "slice_max() or slice_min() replaced top_n(). They take the column to sort by first, then n.",
  sample_n: "slice_sample(n = ) replaced sample_n().",
  sample_frac: "slice_sample(prop = ) replaced sample_frac().",
  qplot: "qplot() is retired. Write ggplot() with a geom instead.",
  aes_string: "aes_string() is retired. Inside aes(), write .data[[name]] for a column named in a string.",
  select_: "The verbs ending in an underscore are retired. Use select() with the column names.",
  filter_: "The verbs ending in an underscore are retired. Use filter() with the condition.",
  mutate_: "The verbs ending in an underscore are retired. Use mutate().",
  arrange_: "The verbs ending in an underscore are retired. Use arrange().",
  group_by_: "The verbs ending in an underscore are retired. Use group_by().",
  summarise_: "The verbs ending in an underscore are retired. Use summarise().", // standards: dplyr's own name
  melt: "pivot_longer(), from tidyr, replaced reshape2's melt().",
  dcast: "pivot_wider(), from tidyr, replaced reshape2's dcast().",
};

// Calls that draw lines, where ggplot2 3.4 renamed size to linewidth.
const LINE_CALLS = new Set(["geom_line", "geom_path", "geom_step", "geom_segment", "geom_curve", "geom_hline", "geom_vline", "geom_abline", "geom_smooth", "geom_errorbar", "geom_linerange", "geom_rect", "geom_tile", "geom_polygon", "geom_area", "geom_ribbon", "geom_density", "geom_boxplot", "geom_violin", "geom_col", "geom_bar", "geom_histogram", "element_line", "element_rect"]);

// Arguments of stat_summary() renamed in ggplot2 3.3.
const SUMMARY_ARGS: Record<string, string> = { "fun.y": "fun", "fun.ymin": "fun.min", "fun.ymax": "fun.max" };

/** Retired code in a script, as hints: a fix when the change is a plain
 * rename, and what to use instead otherwise. */
export function findOutdated(code: string): Hint[] {
  const tokens = tokenize(code);
  const hints: Hint[] = [];
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  // The call each token sits inside, innermost last, to know whose
  // argument a name is.
  const calls: string[] = [];
  const add = (token: Token, title: string, detail: string, fix?: string) => hints.push({ line: token.line, from: token.col, to: token.end, title, detail, fix });

  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (isOp(k, "(")) {
      calls.push(tokens[k - 1]?.kind === "ident" ? tokens[k - 1].text : "");
      continue;
    }
    if (isOp(k, ")")) {
      calls.pop();
      continue;
    }
    if (token.kind !== "ident") continue;
    const after$ = isOp(k - 1, "$") || isOp(k - 1, "@");
    if (after$) continue;
    const called = isOp(k + 1, "(");
    const named = isOp(k + 1, "=") && (isOp(k - 1, "(") || isOp(k - 1, ","));
    const inside = calls[calls.length - 1] ?? "";
    if (called && RENAMED[token.text]) {
      const { to, pkg } = RENAMED[token.text];
      add(token, `${token.text}() is now ${to}()`, `${pkg} renamed ${token.text}() to ${to}(). It takes the same arguments, so this changes the name only.`, to);
    } else if (called && RETIRED[token.text]) {
      add(token, `${token.text}() is retired`, RETIRED[token.text]);
    } else if (named && token.text === "size" && LINE_CALLS.has(inside)) {
      add(token, "size is now linewidth for lines", `Since ggplot2 3.4, the thickness of lines in ${inside}() is set with linewidth. size still sets the size of points and text.`, "linewidth");
    } else if (named && SUMMARY_ARGS[token.text] && inside === "stat_summary") {
      add(token, `${token.text} is now ${SUMMARY_ARGS[token.text]}`, `ggplot2 renamed the arguments of stat_summary(): ${token.text} is now ${SUMMARY_ARGS[token.text]}.`, SUMMARY_ARGS[token.text]);
    } else if (/^\.\.[A-Za-z_][\w.]*\.\.$/.test(token.text)) {
      const inner = token.text.slice(2, -2);
      add(token, `${token.text} is now after_stat(${inner})`, "ggplot2 retired the dot-dot names for computed values. after_stat() does the same thing.", `after_stat(${inner})`);
    } else if (token.text === "FALSE" && inside === "guides" && isOp(k - 1, "=")) {
      add(token, 'Use "none" to hide a legend', 'ggplot2 retired FALSE for hiding a legend in guides(). "none" does the same thing.', '"none"');
    }
  }
  return hints;
}

/** Fixes taken from the deprecation warnings R printed for a statement,
 * worded the way lifecycle, used across the tidyverse, words them:
 * "`old()` was deprecated in pkg 1.0. Please use `new()` instead." and
 * "The `old` argument of `fn()` is deprecated ... Please use the `new`
 * argument instead." Lines count from the statement's first line. */
export function fixesFromWarnings(code: string, warnings: string): Hint[] {
  // Each warning is matched on its own, so one without a replacement never
  // borrows the next one's.
  const parts = warnings
    .replace(/[‘’]/g, "`")
    .replace(/\s+/g, " ")
    .split(/(?<!argument of )(?=`[A-Za-z.][\w.]*\(\)` (?:was|is) deprecated)|(?=The `[A-Za-z.][\w.]*` argument of)/);
  const hints: Hint[] = [];
  const tokens = tokenize(code);
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  const seen = new Set<string>();
  for (const found of parts.flatMap((part) => [...part.matchAll(/`([A-Za-z.][\w.]*)\(\)` (?:was|is) deprecated in ([\w.]+ [\d.]+)\.? .*?Please use `([A-Za-z.][\w.]*)\(\)` instead/g)])) {
    const [, from, since, to] = found;
    tokens.forEach((token, k) => {
      if (token.kind !== "ident" || token.text !== from || !isOp(k + 1, "(") || seen.has(`${token.line}:${token.col}`)) return;
      seen.add(`${token.line}:${token.col}`);
      hints.push({ line: token.line, from: token.col, to: token.end, title: `${from}() is now ${to}()`, detail: `R warned that ${from}() was retired in ${since}, and to use ${to}() instead.`, fix: to });
    });
  }
  for (const found of parts.flatMap((part) => [...part.matchAll(/The `([A-Za-z.][\w.]*)` argument of `([A-Za-z.][\w.]*)\(\)` (?:is|was) deprecated (?:as of|in) ([\w.]+ [\d.]+)\.? .*?Please use (?:the )?`([A-Za-z.][\w.]*)` argument instead/g)])) {
    const [, from, fn, since, to] = found;
    tokens.forEach((token, k) => {
      if (token.kind !== "ident" || token.text !== from || !isOp(k + 1, "=") || seen.has(`${token.line}:${token.col}`)) return;
      seen.add(`${token.line}:${token.col}`);
      hints.push({ line: token.line, from: token.col, to: token.end, title: `${from} is now ${to}`, detail: `R warned that the ${from} argument of ${fn}() was retired in ${since}, and to use ${to} instead.`, fix: to });
    });
  }
  return hints;
}
