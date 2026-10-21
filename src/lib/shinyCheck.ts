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
// the usual way apps are written, and stays quiet about anything it cannot
// be sure of, such as ids built with paste() or apps split into modules.
// It depends on nothing, so it can be tested alone.

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
export const INPUT_MAKERS = /^(\w*Input|actionButton|actionLink|radioButtons|checkboxGroupInput|selectizeInput|varSelectInput|submitButton|\w+Picker|\w+Switch)$/;
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
const CONSUMERS = /^(render\w*|reactive|eventReactive|observe|observeEvent|isolate|bindEvent|reactivePoll|downloadHandler|withProgress)$/;
// Ways to make a reactive that is read by calling it, as name().
export const REACTIVE_MAKERS = new Set(["reactive", "eventReactive", "reactiveVal", "reactivePoll", "reactiveFileReader"]);
// Apps built from modules, or with ids made in code, give ids that cannot
// be read from the text, so the id checks stay quiet for them.
const DYNAMIC_IDS = /\b(NS|moduleServer|callModule|insertUI)\s*\(|\b(inputId|outputId)\s*=\s*paste/;

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
    const d = candidate.toLowerCase() === name.toLowerCase() ? 0.5 : distance(name, candidate);
    if (d < score) [best, score] = [candidate, d];
  }
  return score <= Math.max(1, Math.min(2, Math.floor(name.length / 3))) ? best : undefined;
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

/**
 * Checks the files of one app together, such as app.R alone, or ui.R and
 * server.R with global.R. Returns the likely mistakes in file order.
 */
export function checkShinyApp(files: { file: string; text: string }[]): ShinyFinding[] {
  const uiInputs: Id[] = [];
  const uiOutputs: Id[] = [];
  const serverOutputs: (Id & { render?: string })[] = [];
  const inputReads: (Id & { context: "consumer" | "server" | "other" })[] = [];
  const reactives = new Map<string, Place>();
  const uses: Place[] = [];
  const findings: ShinyFinding[] = [];
  const dynamic = files.some(({ text }) => DYNAMIC_IDS.test(text));

  for (const { file, text } of files) {
    const tokens = tokenize(text);
    // Open brackets, each with the call it belongs to and whether it is the
    // body of a function that takes `input`, which is a server function.
    const stack: { char: string; call: string | null; server?: boolean; fn?: boolean }[] = [];
    let pendingBody: "server" | "fn" | null = null;
    // A function written without braces, as function() input$n, has its
    // body on the rest of its line. Reads there are inside that function.
    let bareFunction: { line: number; depth: number } | null = null;
    const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
    // The call the token being read sits directly inside, by name.
    const callOf = () => {
      const top = stack[stack.length - 1];
      return top?.char === "(" ? top.call : null;
    };
    for (let k = 0; k < tokens.length; k += 1) {
      const token = tokens[k];
      if (token.kind === "op" && (token.text === "(" || token.text === "{" || token.text === "[")) {
        if (token.text === "(") {
          const name = tokens[k - 1]?.kind === "ident" ? tokens[k - 1].text : null;
          if (name === "function" || isOp(k - 1, "\\")) {
            // The parameters decide whether this is a server function.
            let depth = 0;
            let takesInput = false;
            let j = k;
            for (; j < tokens.length; j += 1) {
              if (isOp(j, "(")) depth += 1;
              else if (isOp(j, ")")) {
                depth -= 1;
                if (depth === 0) break;
              } else if (depth === 1 && tokens[j].text === "input" && (isOp(j - 1, "(") || isOp(j - 1, ","))) takesInput = true;
            }
            pendingBody = takesInput ? "server" : "fn";
            if (!isOp(j + 1, "{") && tokens[j + 1]) {
              bareFunction = { line: tokens[j + 1].line, depth: stack.length };
              pendingBody = null;
            }
          }
          stack.push({ char: "(", call: name });
        } else if (token.text === "{") {
          stack.push({ char: "{", call: null, server: pendingBody === "server", fn: pendingBody === "fn" });
          pendingBody = null;
        } else stack.push({ char: "[", call: null });
        continue;
      }
      if (token.kind === "op" && (token.text === ")" || token.text === "}" || token.text === "]")) {
        stack.pop();
        continue;
      }

      // An id given to a function that makes an input or an output, as its
      // first argument or by name.
      if (token.kind === "string") {
        const call = callOf();
        const first = isOp(k - 1, "(");
        const named = isOp(k - 1, "=") && (tokens[k - 2]?.text === "inputId" || tokens[k - 2]?.text === "outputId");
        if (call && (first || named)) {
          const id = { file, token, id: token.value, fn: call };
          if (OUTPUT_MAKERS.test(call) && (first || tokens[k - 2]?.text === "outputId")) uiOutputs.push(id);
          else if (INPUT_MAKERS.test(call) && (first || tokens[k - 2]?.text === "inputId")) uiInputs.push(id);
        }
        continue;
      }
      if (token.kind !== "ident") continue;

      // output$id <- renderX(...), or output[["id"]] <- ...
      if (token.text === "output" && !isOp(k - 1, "$")) {
        let idToken: Token | undefined;
        let next = k + 2;
        if (isOp(k + 1, "$")) idToken = tokens[k + 2];
        else if (isOp(k + 1, "[") && isOp(k + 2, "[") && tokens[k + 3]?.kind === "string") {
          idToken = tokens[k + 3];
          next = k + 5;
        }
        if (idToken && (isOp(next + 1, "<-") || isOp(next + 1, "="))) {
          let r = next + 2;
          if (tokens[r]?.kind === "ident" && isOp(r + 1, "::")) r += 2;
          const render = tokens[r]?.kind === "ident" ? tokens[r].text : undefined;
          serverOutputs.push({ file, token: idToken, id: idToken.value, fn: "output", render });
          const renderish = render && /render|Handler$/i.test(render);
          if (!renderish && tokens[r]) {
            const shown = tokens[r].text;
            findings.push(
              at(
                { file, token: tokens[r] },
                `output$${idToken.value} needs a render function`,
                `An output is filled by a render function, such as renderPlot({ ... }) or renderText({ ... }), which reruns when its inputs change. Putting ${shown} straight into output$${idToken.value} makes the app stop with an error. Wrap the code in the render function that matches the kind of output.`,
              ),
            );
          }
        }
        continue;
      }

      // input$id, read somewhere.
      if (token.text === "input" && isOp(k + 1, "$") && !isOp(k - 1, "$") && tokens[k + 2]) {
        let context: "consumer" | "server" | "other" = "other";
        const inBareFunction = bareFunction && token.line === bareFunction.line && stack.length >= bareFunction.depth;
        for (let s = inBareFunction ? -1 : stack.length - 1; s >= 0; s -= 1) {
          const entry = stack[s];
          if (entry.call && CONSUMERS.test(entry.call)) {
            context = "consumer";
            break;
          }
          // Inside a helper function, the reader cannot tell where it is
          // called from, so it is not judged.
          if (entry.fn) break;
          if (entry.server) {
            context = "server";
            break;
          }
        }
        inputReads.push({ file, token: tokens[k + 2], id: tokens[k + 2].value, fn: "input", context });
        continue;
      }

      // name <- reactive(...), a reactive read by calling it.
      if ((isOp(k + 1, "<-") || isOp(k + 1, "=")) && tokens[k + 2]?.kind === "ident" && REACTIVE_MAKERS.has(tokens[k + 2].text) && isOp(k + 3, "(")) {
        if (!isOp(k - 1, "$") && stack.length > 0) reactives.set(token.text, { file, token });
        continue;
      }
      if (!isOp(k - 1, "$") && !isOp(k - 1, "@") && !isOp(k - 1, "::")) uses.push({ file, token });
    }
  }

  // A reactive used as a plain name rather than called, as data rather
  // than data(). Its own definition, assignments to it, and named
  // arguments that share its name are not uses.
  for (const place of uses) {
    const name = place.token.text;
    const made = reactives.get(name);
    if (!made || made.token === place.token) continue;
    const tokens = tokenize(files.find((item) => item.file === place.file)?.text ?? "");
    const k = tokens.findIndex((token) => token.line === place.token.line && token.col === place.token.col);
    const after = tokens[k + 1];
    if (!after || (after.kind === "op" && ["(", "<-", "=", "<<-"].includes(after.text))) continue;
    findings.push(
      at(
        place,
        `${name} is a reactive, so it is read as ${name}()`,
        `${name} was made with reactive() on line ${made.token.line + 1}. To get its value, call it with parentheses: ${name}(). Without them, R gets the reactive itself, and the app fails later, far from this line, with a confusing error such as "object of type 'closure' is not subsettable".`,
        { label: `Change to ${name}()`, text: `${name}()` },
      ),
    );
  }

  // Reading an input outside a render function, reactive, or observer.
  for (const read of inputReads) {
    if (read.context !== "server") continue;
    findings.push(
      at(
        read,
        `input$${read.id} is read outside a reactive`,
        `Inputs change while the app runs, so they can only be read inside code that reruns when they do: a render function such as renderPlot, a reactive(), or an observe(). Here, in the server function itself, it runs only once, so the app stops with an error. Move this line into the render function or reactive that needs it.`,
      ),
    );
  }

  if (!dynamic && (uiInputs.length || uiOutputs.length)) {
    const inputIds = uiInputs.map((item) => item.id);
    const outputIds = uiOutputs.map((item) => item.id);
    const setIds = serverOutputs.map((item) => item.id);
    // The same id twice in the UI: Shiny shows only one of them.
    const seen = new Map<string, Id>();
    for (const item of [...uiInputs, ...uiOutputs]) {
      const before = seen.get(item.id);
      if (before) findings.push(at(item, `The id ${item.id} is used twice`, `${before.fn}() on line ${before.token.line + 1} already uses the id ${item.id}. Each input and output needs its own id. When two share one, Shiny connects only one of them, and the other stays blank or stuck. Give this one a different id.`));
      else seen.set(item.id, item);
    }
    // An output set in the server with no place in the UI.
    for (const output of serverOutputs) {
      if (outputIds.includes(output.id)) continue;
      const near = closestName(output.id, outputIds.filter((id) => !setIds.includes(id)));
      findings.push(
        at(
          output,
          `output$${output.id} has no place in the UI`,
          near
            ? `The UI has no output with the id ${output.id}, so this never shows. It does have ${near}, which nothing in the server fills, so this is probably a typo.`
            : `The UI has no output with the id ${output.id}, so this never shows. Add an output for it to the UI, such as ${output.render && PAIRS[output.render] ? PAIRS[output.render][0] : "plotOutput"}("${output.id}").`,
          near ? { label: `Change to ${near}`, text: near } : undefined,
        ),
      );
    }
    // An output in the UI that nothing in the server fills.
    for (const output of uiOutputs) {
      if (setIds.includes(output.id) || output.fn.startsWith("download")) continue;
      const near = closestName(output.id, setIds.filter((id) => !outputIds.includes(id)));
      if (near) continue; // Reported once, from the server side, above.
      findings.push(at(output, `Nothing fills ${output.fn}("${output.id}")`, `The server never sets output$${output.id}, so this part of the page stays empty. Add output$${output.id} <- a render function in the server.`));
    }
    // A render function that does not suit its output.
    for (const output of serverOutputs) {
      const shown = uiOutputs.find((item) => item.id === output.id);
      const suits = output.render ? PAIRS[output.render] : undefined;
      if (!shown || !suits || suits.includes(shown.fn) || !/Output$|^download/.test(shown.fn) || !Object.values(PAIRS).flat().includes(shown.fn)) continue;
      findings.push(
        at(
          shown,
          `${shown.fn} cannot show ${output.render}`,
          `output$${output.id} is made with ${output.render} on line ${output.token.line + 1}, which fills ${suits[0]}, but the UI shows it with ${shown.fn}, so it stays empty or shows an error. Use ${suits[0]} in the UI.`,
          { label: `Change to ${suits[0]}`, text: suits[0] },
        ),
      );
      const fix = findings[findings.length - 1];
      // The fix replaces the function's name, which sits before the id.
      const tokens = tokenize(files.find((item) => item.file === shown.file)?.text ?? "");
      const k = tokens.findIndex((token) => token === shown.token || (token.line === shown.token.line && token.col === shown.token.col));
      const name = tokens[k - 2];
      if (fix.fix && name?.text === shown.fn) Object.assign(fix, { line: name.line, from: name.col, to: name.end, fix: { ...fix.fix, line: name.line, from: name.col, to: name.end } });
    }
    // An input read in the server that the UI never makes.
    for (const read of inputReads) {
      if (inputIds.includes(read.id) || read.token.kind !== "ident") continue;
      const near = closestName(read.id, inputIds);
      findings.push(
        at(
          read,
          `The UI has no input called ${read.id}`,
          near
            ? `input$${read.id} is always empty (NULL), because the UI makes no input with that id. It does have ${near}, so this is probably a typo.`
            : `input$${read.id} is always empty (NULL), because the UI makes no input with that id. Check the id given to the input in the UI.`,
          near ? { label: `Change to ${near}`, text: near } : undefined,
        ),
      );
    }
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.from - b.from);
}
