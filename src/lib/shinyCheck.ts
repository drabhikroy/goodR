// Mistakes in a Shiny app that R itself does not point at.
//
// Many Shiny bugs give no error at all, or one far from the cause: an
// output whose id is spelled one way in the UI and another in the server
// simply never appears; an input read under a name the UI does not have is
// always NULL; a reactive used without its parentheses fails later with
// "object of type 'closure' is not subsettable"; reading input$x outside a
// render function or reactive stops the app with a message about reactive
// consumers that names no line. This reads the app's code as written, with
// no R needed, and finds those mistakes at the line that causes them,
// with a fix where one is clear, before the app is even run.
//
// It is a careful reader, not R: it knows Shiny's own function names and
// the usual way apps are written. It reads the whole app, so an id made in
// a helper, in R/, or from the page's JavaScript counts, and it speaks up
// only when it is sure, since a check that is often wrong is soon ignored.
// It stays quiet about apps built from modules and about ids built from
// parts with nothing fixed to go by. It depends on nothing, so it can be
// tested alone.

/** A change that fixes a finding: replace columns from to to on a line. */
export type ShinyFix = { label: string; file: string; line: number; from: number; to: number; text: string };

/** One likely mistake, at a zero based line and columns, with a fix when
 * one is clear. */
export type ShinyFinding = { file: string; line: number; from: number; to: number; title: string; detail: string; fix?: ShinyFix };

type Token = { kind: "ident" | "string" | "number" | "op"; text: string; value: string; line: number; col: number; end: number };

// Operators, longest first, so <<- is read before <-.
const OPERATORS = ["<<-", "->>", ":::", "|>", "<-", "->", "<=", ">=", "==", "!=", "&&", "||", "::"];

/** Splits R code into tokens with their positions, leaving out comments. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 0;
  let col = 0;
  let i = 0;
  const advance = (count: number) => {
    for (let k = 0; k < count; k += 1) {
      if (text[i] === "\n") {
        line += 1;
        col = 0;
      } else col += 1;
      i += 1;
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") advance(1);
      continue;
    }
    if (/\s/.test(ch)) {
      advance(1);
      continue;
    }
    const start = { line, col };
    // Raw strings, such as r"(C:\path)", hold quotes and backslashes as
    // they are, and end only at their own closing bracket and quote.
    const raw = /^[rR](["'])(-*)([([{])/.exec(text.slice(i, i + 40));
    if (raw && !/[\w.]/.test(text[i - 1] ?? "")) {
      const closer = { "(": ")", "[": "]", "{": "}" }[raw[3]] + raw[2] + raw[1];
      const close = text.indexOf(closer, i + raw[0].length);
      const length = (close === -1 ? text.length : close + closer.length) - i;
      const body = text.slice(i, i + length);
      advance(length);
      tokens.push({ kind: "string", text: body, value: body.slice(raw[0].length, close === -1 ? undefined : -closer.length), line: start.line, col: start.col, end: start.line === line ? col : start.col + length });
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      const raw = text.slice(i, j + 1);
      advance(raw.length);
      tokens.push({ kind: ch === "`" ? "ident" : "string", text: raw, value: raw.slice(1, -1), line: start.line, col: start.col, end: start.line === line ? col : start.col + raw.length });
      continue;
    }
    const word = /^[A-Za-z.][\w.]*/.exec(text.slice(i, i + 200));
    if (word && !/^\.\d/.test(word[0])) {
      advance(word[0].length);
      tokens.push({ kind: "ident", text: word[0], value: word[0], line: start.line, col: start.col, end: col });
      continue;
    }
    // Numbers such as 2, 0.5, .5, 1e-5, 0x1F, and 10L, read as one token.
    const number = /^(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\w.]*/.exec(text.slice(i, i + 50));
    if (number) {
      advance(number[0].length);
      tokens.push({ kind: "number", text: number[0], value: number[0], line: start.line, col: start.col, end: col });
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, i)) ?? ch;
    advance(op.length);
    tokens.push({ kind: "op", text: op, value: op, line: start.line, col: start.col, end: col });
  }
  return tokens;
}

// Shiny's functions that make an input, by the id they are given first.
export const INPUT_MAKERS = /^(?!update)(\w*Input|actionButton|actionLink|radioButtons|checkboxGroupInput|selectizeInput|varSelectInput|submitButton|\w+Picker|\w+Switch)$/;
// Functions that show an output, by the id they are given first.
export const OUTPUT_MAKERS = /^\w*(Output|OutputUI)$|^DTOutput$|^downloadButton$|^downloadLink$/;
// Which output functions each render function can fill. A pair missing
// from here is not judged.
const PAIRS: Record<string, string[]> = {
  renderPlot: ["plotOutput", "imageOutput"],
  renderImage: ["imageOutput", "plotOutput"],
  renderText: ["textOutput", "verbatimTextOutput", "htmlOutput", "uiOutput"],
  renderPrint: ["verbatimTextOutput", "textOutput"],
  renderTable: ["tableOutput"],
  renderDataTable: ["dataTableOutput", "DTOutput"],
  renderDT: ["DTOutput", "dataTableOutput"],
  renderUI: ["uiOutput", "htmlOutput"],
  downloadHandler: ["downloadButton", "downloadLink"],
};
// Calls whose code reruns when the inputs it reads change, the only places
// input$x can be read.
const CONSUMERS = /^(render\w*|reactive|eventReactive|observe|observeEvent|isolate|bindEvent|bindCache|reactivePoll|downloadHandler|withProgress)$/;
// Ways to make a reactive that is read by calling it, as name().
export const REACTIVE_MAKERS = new Set(["reactive", "eventReactive", "reactiveVal", "reactivePoll", "reactiveFileReader"]);
// Calls whose contents exist only some of the time: a branch, a piece of
// page built in the server, or a dialog. Two inputs with one id there are
// usually alternatives, never on the page together.
const SOMETIMES = new Set(["switch", "ifelse", "if_else", "renderUI", "modalDialog", "showModal", "insertUI"]);
// Calls that need the value itself, so a reactive given to them bare is a
// mistake. A reactive handed to any other function may be meant, since
// passing it along to be called later is how apps share one.
const VALUE_CALLS = new Set(
  "if nrow ncol NROW NCOL dim length is.null names colnames rownames head tail summary print str unique sort sum mean median min max range table nchar paste paste0 sprintf format round as.numeric as.character as.integer as.data.frame as.list unlist subset ggplot plot hist barplot filter select mutate arrange group_by summarise summarize count distinct pull left_join inner_join merge rbind cbind is.na any all which seq_along rev levels factor isTRUE isFALSE datatable kable".split(" "), // standards: dplyr spells its verb summarise, so both are listed
);
// Operators next to a name that use its value.
const VALUE_OPS = new Set(["$", "[", "@", "+", "-", "*", "/", "^", "==", "!=", "<", ">", "<=", ">=", "&", "&&", "|", "||", "!", "%", "|>"]);
// Values that cannot fill an output, put straight into output$x.
const NOT_RENDERED = new Set(["ggplot", "plot", "hist", "barplot", "data.frame", "tibble", "paste", "paste0", "sprintf", "table", "summary", "head", "c", "print", "format", "round"]);

type Place = { file: string; token: Token };
type Id = Place & { id: string; fn: string };

/** The edit distance between two short names, for spelling suggestions. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let x = 1; x <= a.length; x += 1) {
    let previous = row[0];
    row[0] = x;
    for (let y = 1; y <= b.length; y += 1) {
      const kept = row[y];
      row[y] = Math.min(row[y] + 1, row[y - 1] + 1, previous + (a[x - 1] === b[y - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

/** The closest of `names` to `name`, when it is close enough to be a typo. */
export function closestName(name: string, names: string[]): string | undefined {
  let best: string | undefined;
  let score = Infinity;
  for (const candidate of names) {
    if (candidate === name) continue;
    const d = candidate.toLowerCase() === name.toLowerCase() ? 0.5 : distance(name, candidate);
    if (d < score) [best, score] = [candidate, d];
  }
  return score <= Math.max(1, Math.min(2, Math.floor(name.length / 3))) ? best : undefined;
}

/** Splits an id into its words: plot_height and plotHeight both give
 * plot and height. */
function parts(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_.-]+/)
    .filter(Boolean);
}

/** The closest of `names` to `id` that looks like a slip of the keys:
 * the same words, with one of them a letter or two off. go_games and
 * dl_games differ by a whole word, so they are two ids, not a typo. */
function typoOf(id: string, names: string[]): string | undefined {
  const mine = parts(id);
  const near = names.filter((name) => {
    if (name === id) return false;
    if (name.toLowerCase() === id.toLowerCase()) return true;
    const theirs = parts(name);
    if (theirs.length !== mine.length) return false;
    const differ = mine.map((part, n) => [part, theirs[n]]).filter(([a, b]) => a !== b);
    if (differ.length !== 1) return false;
    const [a, b] = differ[0];
    return distance(a, b) <= (Math.min(a.length, b.length) >= 6 ? 2 : 1) && Math.min(a.length, b.length) >= Math.min(2, Math.max(a.length, b.length));
  });
  return closestName(id, near);
}

/** A finding at a token, with an optional fix that replaces it. */
function at(place: Place, title: string, detail: string, fix?: { label: string; text: string }): ShinyFinding {
  const { token, file } = place;
  return {
    file,
    line: token.line,
    from: token.col,
    to: token.end,
    title,
    detail,
    fix: fix && { label: fix.label, file, line: token.line, from: token.col, to: token.end, text: fix.text },
  };
}

// A function's body, with the names that are its own there, so a name
// reused for something else is not taken for a reactive outside.
type Scope = { params: Set<string>; order: string[]; locals: Set<string>; name?: string };

/** What one file of an app says: the ids it makes, sets, and reads, its
 * reactives and how they are used, and every word inside its strings. */
type Facts = {
  inputs: (Id & { sometimes: boolean })[];
  outputs: (Id & { sometimes: boolean })[];
  sets: (Id & { render?: string; value?: Token })[];
  reads: (Id & { context: "consumer" | "server" | "other" })[];
  reactives: (Place & { name: string; scope: number })[];
  uses: (Place & { name: string; chain: number[] })[];
  extraInputs: Set<string>;
  words: Set<string>;
  // Functions that pass one of their arguments on as an input's or an
  // output's id, such as card <- function(id) uiOutput(id), by the
  // argument's place, and the strings each call gives, by place.
  helpers: Map<string, { kind: "input" | "output"; at: number }>;
  calls: { call: string; at: number; token: Token; file: string }[];
  // The fixed start of ids built in code, such as "plot_" in
  // paste0("plot_", i), and whether any id is built with no fixed start.
  prefixes: Set<string>;
  suffixes: Set<string>;
  dynamicInputs: boolean;
  dynamicOutputs: boolean;
};

const scopes: Scope[] = [];

/** Every word in a string, so an id named in a label, a selector, or a
 * line of JavaScript counts as named somewhere. */
// Pages set inputs of their own from JavaScript, as with
// Shiny.setInputValue("id", value) in www/ or in an onclick in R.
const SET_FROM_PAGE = /(?:setInputValue|onInputChange)\(\s*["'`]([\w.]+)["'`]/g;

function addWords(words: Set<string>, text: string) {
  for (const match of text.matchAll(/[A-Za-z_][\w.-]*/g)) {
    words.add(match[0]);
    for (const part of match[0].split(/[.-]/)) if (part) words.add(part);
  }
}

/** The quoted strings of a JavaScript file, where pages set inputs with
 * Shiny.setInputValue("id", ...). */
function jsFacts(text: string): Facts {
  const words = new Set<string>();
  for (const match of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) addWords(words, match[2]);
  return { ...emptyFacts(), words, extraInputs: new Set([...text.matchAll(SET_FROM_PAGE)].map((match) => match[1])) };
}

function emptyFacts(): Facts {
  return {
    inputs: [],
    outputs: [],
    sets: [],
    reads: [],
    reactives: [],
    uses: [],
    extraInputs: new Set(),
    words: new Set(),
    helpers: new Map(),
    calls: [],
    prefixes: new Set(),
    suffixes: new Set(),
    dynamicInputs: false,
    dynamicOutputs: false,
  };
}

// Calls that build a string from parts, as ids made in a loop are.
const BUILDERS = new Set(["paste", "paste0", "sprintf", "glue", "str_c", "str_glue", "ns", "NS"]);

/** Reads one R file of an app for what the checks need. */
function readFacts(file: string, text: string): Facts {
  const facts = emptyFacts();
  const tokens = tokenize(text);
  // Open brackets, each with the call it belongs to. A function's body
  // carries its scope, and whether it is a server function, one that takes
  // both input and output. `sometimes` marks a branch of an if, a switch,
  // or a piece of page built later.
  type Frame = { char: string; call: string | null; scope?: number; server?: boolean; sometimes?: boolean; condition?: boolean; args: number };
  const stack: Frame[] = [];
  const top = scopes.push({ params: new Set(), order: [], locals: new Set() }) - 1;
  let pendingBody: { scope: number; server: boolean; at: number } | null = null;
  // A function written without braces, as function() input$n, has its
  // body on the rest of its line. Reads there are inside that function.
  let bareFunction: { line: number; depth: number } | null = null;
  let conditionClosed = -1;
  const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
  const isWord = (k: number, word: string) => tokens[k]?.kind === "ident" && tokens[k].text === word;
  const callOf = () => {
    const frame = stack[stack.length - 1];
    return frame?.char === "(" ? frame.call : null;
  };
  const scopeOf = () => {
    for (let s = stack.length - 1; s >= 0; s -= 1) if (stack[s].scope !== undefined) return stack[s].scope!;
    return top;
  };
  const chain = () => [top, ...stack.filter((frame) => frame.scope !== undefined).map((frame) => frame.scope!)];
  // An id is made only some of the time when any bracket around it is a
  // function, a branch, or a piece of page built later, or when the call
  // making it follows if (...) or else directly.
  const sometimes = (call: number) =>
    stack.some((frame) => frame.scope !== undefined || frame.sometimes) || isWord(call - 1, "else") || (isOp(call - 1, ")") && call - 1 === conditionClosed);
  // An id given as code rather than a string, starting at token `k`.
  const noteBuiltId = (k: number, kind: "input" | "output") => {
    const first = tokens[k];
    if (first.kind === "ident" && (isOp(k + 1, ",") || isOp(k + 1, ")"))) {
      const scope = scopes[scopeOf()];
      const at = scope.order.indexOf(first.text);
      if (scope.name && at >= 0) {
        facts.helpers.set(scope.name, { kind, at });
        return;
      }
    }
    if (first.kind === "ident" && BUILDERS.has(first.text) && isOp(k + 1, "(")) {
      const part = tokens[k + 2];
      if (part?.kind === "string") {
        // ns("x") gives the id itself. paste0("x_", i) gives its start.
        if (/^n[sS]$|^NS$/.test(first.text)) (kind === "input" ? facts.extraInputs : facts.prefixes).add(part.value);
        else if (part.value.length >= 2) facts.prefixes.add(part.value.replace(/%.*$|\{.*$/, ""));
        return;
      }
    }
    // Only an id built from parts with no fixed start, such as
    // paste0(prefix, i), leaves no trace in the text. A name or a field,
    // as in uiOutput(id) or downloadButton(d$id), holds a string written
    // somewhere else in the app, which is already counted.
    if (first.kind === "ident" && BUILDERS.has(first.text) && isOp(k + 1, "(")) {
      // paste0(kk, "_print_note") still has a fixed end to go by.
      let depth = 0;
      for (let j = k + 1; j < tokens.length; j += 1) {
        if (isOp(j, "(")) depth += 1;
        else if (isOp(j, ")") && (depth -= 1) === 0) break;
        else if (depth === 1 && tokens[j].kind === "string" && tokens[j].value.replace(/%\w/g, "").length >= 3) {
          facts.suffixes.add(tokens[j].value.replace(/%\w|\{[^}]*\}/g, ""));
          return;
        }
      }
      if (kind === "input") facts.dynamicInputs = true;
      else facts.dynamicOutputs = true;
    }
  };
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.kind === "op" && (token.text === "(" || token.text === "{" || token.text === "[")) {
      if (token.text === "(") {
        const name = tokens[k - 1]?.kind === "ident" ? tokens[k - 1].text : null;
        const frame: Frame = { char: "(", call: name, sometimes: name !== null && SOMETIMES.has(name), condition: name === "if" || name === "while", args: 0 };
        if (pendingBody?.at === k) {
          frame.scope = pendingBody.scope;
          frame.server = pendingBody.server;
          pendingBody = null;
        }
        if (name === "function" || isOp(k - 1, "\\")) {
          // The parameters decide whether this is a server function.
          const scope: Scope = { params: new Set(), order: [], locals: new Set() };
          // name <- function(...), so calls to it can be followed.
          if (tokens[k - 3]?.kind === "ident" && (isOp(k - 2, "<-") || isOp(k - 2, "="))) scope.name = tokens[k - 3].text;
          let depth = 0;
          let j: number = k;
          for (; j < tokens.length; j += 1) {
            if (isOp(j, "(")) depth += 1;
            else if (isOp(j, ")")) {
              depth -= 1;
              if (depth === 0) break;
            } else if (depth === 1 && tokens[j].kind === "ident" && (isOp(j - 1, "(") || isOp(j - 1, ","))) {
              scope.params.add(tokens[j].text);
              scope.order.push(tokens[j].text);
            }
          }
          const id = scopes.push(scope) - 1;
          const server = scope.params.has("input") && scope.params.has("output");
          if (isOp(j + 1, "{")) pendingBody = { scope: id, server, at: j + 1 };
          else if (tokens[j + 1]?.kind === "ident" && isOp(j + 2, "(")) pendingBody = { scope: id, server, at: j + 2 };
          else if (tokens[j + 1]) bareFunction = { line: tokens[j + 1].line, depth: stack.length };
        }
        // An input or output whose id is not written out. An argument of
        // the function around it makes that function a helper, whose
        // calls give the ids. An id built from parts gives its fixed start.
        if (name && (INPUT_MAKERS.test(name) || OUTPUT_MAKERS.test(name)) && tokens[k + 1] && tokens[k + 1].kind !== "string" && !isOp(k + 1, ")") && !isOp(k + 2, "=")) {
          noteBuiltId(k + 1, INPUT_MAKERS.test(name) ? "input" : "output");
        }
        stack.push(frame);
      } else if (token.text === "{") {
        const frame: Frame = { char: "{", call: null, sometimes: isWord(k - 1, "else") || (isOp(k - 1, ")") && k - 1 === conditionClosed), args: 0 };
        if (pendingBody?.at === k) {
          frame.scope = pendingBody.scope;
          frame.server = pendingBody.server;
          pendingBody = null;
        }
        stack.push(frame);
      } else stack.push({ char: "[", call: null, args: 0 });
      continue;
    }
    if (isOp(k, ",") && stack.length) stack[stack.length - 1].args += 1;
    if (token.kind === "op" && (token.text === ")" || token.text === "}" || token.text === "]")) {
      if (stack.pop()?.condition) conditionClosed = k;
      continue;
    }

    if (token.kind === "string") {
      addWords(facts.words, token.value);
      for (const match of token.value.matchAll(SET_FROM_PAGE)) facts.extraInputs.add(match[1]);
      const call = callOf();
      const first = isOp(k - 1, "(");
      const argument = isOp(k - 1, "=") ? tokens[k - 2]?.text : undefined;
      if (call && (first || argument === "inputId" || argument === "outputId")) {
        const id = { file, token, id: token.value, fn: call, sometimes: sometimes(first ? k - 2 : k - 4) };
        if (OUTPUT_MAKERS.test(call) && argument !== "inputId") facts.outputs.push(id);
        else if (INPUT_MAKERS.test(call) && argument !== "outputId") facts.inputs.push(id);
      }
      if (call && !argument && stack[stack.length - 1].char === "(") facts.calls.push({ call, at: stack[stack.length - 1].args, token, file });
      // A plot's click, hover, and brush, and a table's id, make inputs too.
      if (argument && /^(click|dblclick|hover|brush|id|inputId)$/.test(argument)) facts.extraInputs.add(token.value);
      continue;
    }
    if (token.kind !== "ident") continue;
    if ((token.text === "inputId" || token.text === "outputId") && isOp(k + 1, "=") && tokens[k + 2] && tokens[k + 2].kind !== "string") {
      noteBuiltId(k + 2, token.text === "inputId" ? "input" : "output");
    }

    // output$id <- renderX(...), or output[["id"]] <- ...
    if (token.text === "output" && !isOp(k - 1, "$")) {
      let idToken: Token | undefined;
      let next = k + 2;
      if (isOp(k + 1, "$")) idToken = tokens[k + 2];
      else if (isOp(k + 1, "[") && isOp(k + 2, "[")) {
        if (tokens[k + 3]?.kind === "string") {
          idToken = tokens[k + 3];
          next = k + 5;
        } else if (tokens[k + 3]) noteBuiltId(k + 3, "output");
      }
      if (idToken && (isOp(next + 1, "<-") || isOp(next + 1, "="))) {
        let r = next + 2;
        if (tokens[r]?.kind === "ident" && isOp(r + 1, "::")) r += 2;
        const render = tokens[r]?.kind === "ident" ? tokens[r].text : undefined;
        facts.sets.push({ file, token: idToken, id: idToken.value, fn: "output", render, value: tokens[r] });
      }
      continue;
    }

    // input$id or input[["id"]], read somewhere.
    if (token.text === "input" && !isOp(k - 1, "$")) {
      const idToken = isOp(k + 1, "$") ? tokens[k + 2] : isOp(k + 1, "[") && isOp(k + 2, "[") && tokens[k + 3]?.kind === "string" ? tokens[k + 3] : undefined;
      if (!idToken) continue;
      let context: "consumer" | "server" | "other" = "other";
      const inBareFunction = bareFunction && token.line === bareFunction.line && stack.length >= bareFunction.depth;
      for (let s = inBareFunction ? -1 : stack.length - 1; s >= 0; s -= 1) {
        const frame = stack[s];
        if (frame.call && CONSUMERS.test(frame.call)) {
          context = "consumer";
          break;
        }
        // Inside a helper function, the reader cannot tell where it is
        // called from, so it is not judged.
        if (frame.scope !== undefined) {
          if (frame.server) context = "server";
          break;
        }
      }
      facts.reads.push({ file, token: idToken, id: idToken.value, fn: "input", context });
      continue;
    }

    if (isOp(k - 1, "$") || isOp(k - 1, "@") || isOp(k - 1, "::")) continue;
    const assigned = isOp(k + 1, "<-") || isOp(k + 1, "<<-") || (isOp(k + 1, "=") && (stack.length === 0 || stack[stack.length - 1].char === "{"));
    if (assigned) {
      // name <- reactive(...), a reactive read by calling it. Any other
      // value makes the name an ordinary one in this function.
      if (tokens[k + 2]?.kind === "ident" && REACTIVE_MAKERS.has(tokens[k + 2].text) && isOp(k + 3, "(")) {
        if (stack.length > 0) facts.reactives.push({ file, token, name: token.text, scope: scopeOf() });
      } else scopes[scopeOf()].locals.add(token.text);
      continue;
    }
    if (isWord(k - 2, "for") && isOp(k - 1, "(")) {
      scopes[scopeOf()].locals.add(token.text);
      continue;
    }
    // A use that needs the value: before $ or [, beside an operator, or
    // given to a function that needs the value, such as nrow() or if ().
    const after = tokens[k + 1];
    const before = tokens[k - 1];
    if (after?.kind === "op" && ["(", "=", "<-"].includes(after.text)) continue;
    const call = callOf();
    const needsValue =
      (after?.kind === "op" && VALUE_OPS.has(after.text)) ||
      (before?.kind === "op" && VALUE_OPS.has(before.text) && before.text !== "$" && before.text !== "@") ||
      ((isOp(k - 1, "(") || isOp(k - 1, ",")) && (isOp(k + 1, ")") || isOp(k + 1, ",")) && call !== null && VALUE_CALLS.has(call));
    if (needsValue) facts.uses.push({ file, token, name: token.text, chain: chain() });
  }
  return facts;
}

/**
 * Checks the files of one app together, such as app.R alone, or ui.R and
 * server.R with global.R, and returns the likely mistakes in file order.
 * `context` is the rest of the app's code, R helpers and the JavaScript
 * in www/: ids made or named there count, but nothing there is reported.
 *
 * Every check is built to stay quiet when it cannot be sure. An id that
 * does not match is reported only when it is one letter or two from an
 * id that does exist, since an id named nowhere else is far more often
 * made in a way the text does not show than a mistake.
 */
// Only the ids, strings, and helpers of these files are used, never their
// scopes, so keeping them across checks is safe.
const contextFacts = new Map<string, { text: string; facts: Facts }>();

export function checkShinyApp(files: { file: string; text: string }[], context: { file: string; text: string }[] = []): ShinyFinding[] {
  scopes.length = 0;
  const checked = files.map(({ file, text }) => readFacts(file, text));
  const others = context.map(({ file, text }) => {
    // The rest of an app rarely changes while one file is being typed in,
    // so what each of its files says is kept until its text changes.
    const kept = contextFacts.get(file);
    if (kept?.text === text) return kept.facts;
    const facts = /\.js$/i.test(file) ? jsFacts(text) : readFacts(file, text);
    if (contextFacts.size > 500) contextFacts.clear();
    contextFacts.set(file, { text, facts });
    return facts;
  });
  const all = [...checked, ...others];
  const findings: ShinyFinding[] = [];

  // Ids given to helpers that pass them on to an input or output.
  const helpers = new Map(all.flatMap((facts) => [...facts.helpers]));
  const helped = { input: new Set<string>(), output: new Set<string>() };
  for (const facts of all) {
    for (const call of facts.calls) {
      const helper = helpers.get(call.call);
      if (helper && helper.at === call.at) helped[helper.kind].add(call.token.value);
    }
  }
  const inputIds = new Set(all.flatMap((facts) => [...facts.inputs.map((item) => item.id), ...facts.extraInputs]).concat([...helped.input]));
  const outputs = all.flatMap((facts) => facts.outputs);
  const outputIds = new Set([...outputs.map((item) => item.id), ...helped.output]);
  const prefixes = [...new Set(all.flatMap((facts) => [...facts.prefixes]))].filter((prefix) => prefix.length >= 2);
  const suffixes = [...new Set(all.flatMap((facts) => [...facts.suffixes]))].filter((suffix) => suffix.length >= 3);
  const setIds = new Set(all.flatMap((facts) => facts.sets.map((item) => item.id)));
  const words = new Set(all.flatMap((facts) => [...facts.words]));
  const dynamicInputs = all.some((facts) => facts.dynamicInputs);
  const dynamicOutputs = all.some((facts) => facts.dynamicOutputs);
  const modules = [...files, ...context].some(({ text }) => /\b(NS|moduleServer|callModule)\s*\(/.test(text));
  // Tables, maps, and plots make inputs named after their own id, such as
  // table_rows_selected or map_marker_click.
  const madeFrom = (id: string) => [...outputIds, ...setIds, ...inputIds].some((base) => id.startsWith(`${base}_`)) || prefixes.some((prefix) => id.startsWith(prefix)) || suffixes.some((suffix) => id.endsWith(suffix));
  // Inputs the app reads in more than one place and names in a string are
  // ones it has, made by code the text does not show.
  const readIds = all.flatMap((facts) => facts.reads.map((read) => read.id));
  const knownInputs = [...new Set([...inputIds, ...readIds.filter((id) => words.has(id))])];

  // A reactive used for its value without the parentheses that read it.
  for (const facts of checked) {
    for (const use of facts.uses) {
      const made = facts.reactives.find((item) => item.name === use.name && use.chain.includes(item.scope));
      if (!made || made.token === use.token) continue;
      // A function in between that takes or sets the same name has its own.
      const inner = use.chain.slice(use.chain.indexOf(made.scope));
      if (inner.some((scope, n) => (n > 0 && scopes[scope].params.has(use.name)) || scopes[scope].locals.has(use.name))) continue;
      findings.push(
        at(
          use,
          `${use.name} is a reactive, so it is read as ${use.name}()`,
          `${use.name} was made with reactive() on line ${made.token.line + 1}. To get its value, call it with parentheses: ${use.name}(). Without them, R gets the reactive itself, and the app fails later, far from this line, with a confusing error such as "object of type 'closure' is not subsettable".`,
          { label: `Change to ${use.name}()`, text: `${use.name}()` },
        ),
      );
    }

    // Reading an input in the server function itself, outside a render
    // function, reactive, or observer.
    for (const read of facts.reads) {
      if (read.context !== "server") continue;
      findings.push(
        at(
          read,
          `input$${read.id} is read outside a reactive`,
          `Inputs change while the app runs, so they can only be read inside code that reruns when they do: a render function such as renderPlot, a reactive(), or an observe(). Here, in the server function itself, it runs only once, so the app stops with an error. Move this line into the render function or reactive that needs it.`,
        ),
      );
    }

    // A plain value put into an output, which only a render function fills.
    for (const output of facts.sets) {
      const value = output.value;
      if (!value) continue;
      const plain = value.kind === "string" || value.kind === "number" || (value.kind === "op" && (value.text === "(" || value.text === "{")) || (value.kind === "ident" && NOT_RENDERED.has(value.text));
      if (!plain) continue;
      findings.push(
        at(
          { file: output.file, token: value },
          `output$${output.id} needs a render function`,
          `An output is filled by a render function, such as renderPlot({ ... }) or renderText({ ... }), which reruns when its inputs change. Putting ${value.text} straight into output$${output.id} makes the app stop with an error. Wrap the code in the render function that matches the kind of output.`,
        ),
      );
    }

    // The same id twice on one page: Shiny connects only one of them. Ids
    // made in a branch, a function, or a dialog are left alone, since
    // those are usually alternatives that never show together.
    const seen = new Map<string, Id>();
    for (const item of [...facts.inputs, ...facts.outputs].sort((a, b) => a.token.line - b.token.line || a.token.col - b.token.col)) {
      if (item.sometimes) continue;
      const before = seen.get(item.id);
      if (before) findings.push(at(item, `The id ${item.id} is used twice`, `${before.fn}() on line ${before.token.line + 1} already uses the id ${item.id}. Each input and output needs its own id. When two share one, Shiny connects only one of them, and the other stays blank or stuck. Give this one a different id.`));
      else seen.set(item.id, item);
    }

    if (modules) continue;
    // An output set in the server under a name one letter or two from an
    // output in the UI that nothing fills.
    for (const output of facts.sets) {
      if (outputIds.has(output.id) || words.has(output.id) || dynamicOutputs || madeFrom(output.id)) continue;
      const near = typoOf(output.id, [...outputIds].filter((id) => !setIds.has(id)));
      if (!near) continue;
      findings.push(
        at(output, `output$${output.id} has no place in the UI`, `The UI has no output with the id ${output.id}, so this never shows. It does have ${near}, which nothing in the server fills, so this is probably a typo.`, {
          label: `Change to ${near}`,
          text: near,
        }),
      );
    }
    // An input read under a name one letter or two from an input that exists.
    for (const read of facts.reads) {
      if (inputIds.has(read.id) || words.has(read.id) || dynamicInputs || madeFrom(read.id) || read.token.kind !== "ident") continue;
      const near = typoOf(read.id, knownInputs);
      if (!near) continue;
      findings.push(
        at(read, `The UI has no input called ${read.id}`, `input$${read.id} is always empty (NULL), because the UI makes no input with that id. It does have ${near}, so this is probably a typo.`, {
          label: `Change to ${near}`,
          text: near,
        }),
      );
    }
    // A render function that does not suit its output.
    for (const output of facts.sets) {
      const shown = outputs.filter((item) => item.id === output.id);
      const suits = output.render ? PAIRS[output.render] : undefined;
      const one = shown.length === 1 ? shown[0] : undefined;
      if (!one || !suits || suits.includes(one.fn) || !Object.values(PAIRS).flat().includes(one.fn) || !files.some((item) => item.file === one.file)) continue;
      // The fix replaces the function's name, which sits before the id.
      const tokens = tokenize(files.find((item) => item.file === one.file)?.text ?? "");
      const k = tokens.findIndex((token) => token.line === one.token.line && token.col === one.token.col);
      const name = tokens[k - 2];
      const place = name?.text === one.fn ? { file: one.file, token: name } : one;
      findings.push(
        at(
          place,
          `${one.fn} cannot show ${output.render}`,
          `output$${output.id} is made with ${output.render} on line ${output.token.line + 1}, which fills ${suits[0]}, but the UI shows it with ${one.fn}, so it stays empty or shows an error. Use ${suits[0]} in the UI.`,
          name?.text === one.fn ? { label: `Change to ${suits[0]}`, text: suits[0] } : undefined,
        ),
      );
    }
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.from - b.from);
}
