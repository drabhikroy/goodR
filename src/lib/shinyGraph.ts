// How a Shiny app's parts connect: which inputs and reactives each output
// and observer reads, read from the app's code.
//
// The hardest part of a Shiny app to see is the part that is not written
// in one place: when input$bins changes, which outputs draw again, and
// through which reactives. Shiny's own reactlog shows it, but only for a
// running app, after turning it on. This reads the same connections from
// the code as written, so the map is there before the app runs, and a
// connection that is missing, such as an output that reads nothing, shows
// as plainly as one that is there.
//
// Like the checker beside it, it reads code, not R, and stays quiet about
// what it cannot be sure of, such as apps built from modules.

import { INPUT_MAKERS, REACTIVE_MAKERS, tokenize } from "./shinyCheck";

export type NodeKind = "input" | "reactive" | "observer" | "output";

/** One part of the app, with where it is defined or made. */
export type GraphNode = { id: string; kind: NodeKind; label: string; file: string; line: number };

/** `to` reads `from`, or, for a write, `from` sets `to`. */
export type GraphEdge = { from: string; to: string; sets?: boolean };

export type ShinyGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Reads the connections in an app's files. */
export function shinyGraph(files: { file: string; text: string }[]): ShinyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  // Definitions, with the token range of the call that makes each, read
  // in a second pass once every reactive's name is known.
  const bodies: { id: string; file: string; tokens: ReturnType<typeof tokenize>; from: number; to: number }[] = [];
  const reactiveNames = new Set<string>();

  for (const { file, text } of files) {
    const tokens = tokenize(text);
    const isOp = (k: number, op: string) => tokens[k]?.kind === "op" && tokens[k].text === op;
    /** The index of the bracket that closes the one opening at `open`. */
    const closing = (open: number) => {
      let depth = 0;
      for (let k = open; k < tokens.length; k += 1) {
        if (isOp(k, "(") || isOp(k, "{") || isOp(k, "[")) depth += 1;
        else if (isOp(k, ")") || isOp(k, "}") || isOp(k, "]")) {
          depth -= 1;
          if (depth === 0) return k;
        }
      }
      return tokens.length - 1;
    };
    for (let k = 0; k < tokens.length; k += 1) {
      const token = tokens[k];
      if (token.kind !== "ident") continue;
      // An input made in the UI, by the id it is given first.
      if (INPUT_MAKERS.test(token.text) && isOp(k + 1, "(") && tokens[k + 2]?.kind === "string") {
        const id = tokens[k + 2].value;
        nodes.set(`input:${id}`, { id: `input:${id}`, kind: "input", label: `input$${id}`, file, line: token.line });
        continue;
      }
      // name <- reactive(...), and the other ways to make one.
      if ((isOp(k + 1, "<-") || isOp(k + 1, "=")) && tokens[k + 2]?.kind === "ident" && REACTIVE_MAKERS.has(tokens[k + 2].text) && isOp(k + 3, "(")) {
        const id = `reactive:${token.text}`;
        reactiveNames.add(token.text);
        nodes.set(id, { id, kind: "reactive", label: `${token.text}()`, file, line: token.line });
        bodies.push({ id, file, tokens, from: k + 3, to: closing(k + 3) });
        continue;
      }
      // output$id <- renderX(...)
      if (token.text === "output" && isOp(k + 1, "$") && tokens[k + 2] && (isOp(k + 3, "<-") || isOp(k + 3, "=")) && tokens[k + 4]?.kind === "ident" && isOp(k + 5, "(")) {
        const id = `output:${tokens[k + 2].text}`;
        nodes.set(id, { id, kind: "output", label: `output$${tokens[k + 2].text}`, file, line: token.line });
        bodies.push({ id, file, tokens, from: k + 5, to: closing(k + 5) });
        continue;
      }
      // observe(...) and observeEvent(...), named by their line.
      if ((token.text === "observe" || token.text === "observeEvent") && isOp(k + 1, "(") && !isOp(k - 1, "$")) {
        const id = `observer:${file}:${token.line}`;
        nodes.set(id, { id, kind: "observer", label: `${token.text}, line ${token.line + 1}`, file, line: token.line });
        bodies.push({ id, file, tokens, from: k + 1, to: closing(k + 1) });
      }
    }
  }

  // What each definition reads: inputs, and reactives called by name. An
  // observer that calls a reactiveVal with a value sets it.
  for (const body of bodies) {
    const { tokens } = body;
    const seen = new Set<string>();
    for (let k = body.from; k <= body.to; k += 1) {
      const token = tokens[k];
      if (token.kind !== "ident") continue;
      let from: string | null = null;
      let sets = false;
      if (token.text === "input" && tokens[k + 1]?.text === "$" && tokens[k + 2]) from = `input:${tokens[k + 2].text}`;
      else if (token.text === "input" && tokens[k + 1]?.text === "[" && tokens[k + 2]?.text === "[" && tokens[k + 3]?.kind === "string") from = `input:${tokens[k + 3].value}`;
      else if (reactiveNames.has(token.text) && tokens[k + 1]?.text === "(" && tokens[k - 1]?.text !== "$") {
        from = `reactive:${token.text}`;
        sets = body.id.startsWith("observer:") && tokens[k + 2]?.text !== ")";
      }
      if (!from || from === body.id) continue;
      const key = `${from}>${sets}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // An input read but never made in the UI still appears, so the gap
      // between the two can be seen.
      if (!nodes.has(from) && from.startsWith("input:")) {
        const id = from.slice(6);
        nodes.set(from, { id: from, kind: "input", label: `input$${id}`, file: body.file, line: token.line });
      }
      edges.push(sets ? { from: body.id, to: from, sets: true } : { from, to: body.id });
    }
  }
  const order: NodeKind[] = ["input", "reactive", "observer", "output"];
  return {
    nodes: [...nodes.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.file.localeCompare(b.file) || a.line - b.line),
    edges,
  };
}

/** Every node a node depends on and every node that depends on it, for
 * highlighting one path through the map. */
export function connected(graph: ShinyGraph, id: string): Set<string> {
  const found = new Set([id]);
  const walk = (start: string, forward: boolean) => {
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        const next = forward ? (edge.from === current ? edge.to : null) : edge.to === current ? edge.from : null;
        if (next && !found.has(next)) {
          found.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk(id, true);
  walk(id, false);
  return found;
}
