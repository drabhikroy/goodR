// Where an error inside a running Shiny app really happened.
//
// When code in an app fails, Shiny prints "Warning: Error in f: message"
// and then a stack trace, innermost call first, numbered from the outside
// in. Calls in the app's own files carry their file and line in brackets:
//
//   169: helper [/path/app.R#9]
//   168: renderPlot [/path/app.R#17]
//   126: drawPlot
//   112: <reactive:plotObj>
//    82: output$plot
//
// Read from the top, that says the error happened on line 9, inside the
// function helper, which was called by the renderPlot on line 17, which
// was drawing output$plot. RStudio prints the trace as it is, so people
// read the message, look at the line it seems to name, and often look in
// the wrong place, since the first line of the message names a function,
// not a place. This turns the trace into the place, the chain of calls in
// the app's own code that led there, and the output or reactive that was
// being computed, which is what someone needs to find and fix it.
//
// It depends on nothing, so it can be tested alone.

/** One line of a Shiny stack trace. `line` counts from one, as R does. */
export type Frame = { call: string; file?: string; line?: number };

/** Where an app's error happened, as far as the trace shows. */
export type AppErrorPlace = {
  /** The innermost call in the app's own code, where the error happened. */
  at?: { call: string; file: string; line: number };
  /** The calls in the app's code that led there, innermost first. */
  via: { call: string; file: string; line: number }[];
  /** The output being made, such as plot for output$plot. */
  output?: string;
  /** The reactive expression being computed, when it has a name. */
  reactive?: string;
  /** An observer was running, rather than an output being made. */
  observer: boolean;
};

// "  169: helper [/path/app.R#9]" or "   82: output$plot". The call is
// anything up to an optional bracketed source reference at the end.
const FRAME = /^\s*\d+:\s+(.+?)(?:\s+\[(.+)#(\d+)\])?\s*$/;

/** Reads one line of a stack trace, or null when the line is not one. */
export function parseFrame(text: string): Frame | null {
  const match = FRAME.exec(text);
  if (!match) return null;
  const [, call, file, line] = match;
  return file ? { call, file, line: Number(line) } : { call };
}

/**
 * Works out where an error happened from its frames, innermost first, as
 * Shiny prints them. Only frames in the app's own files count as places,
 * so code inside packages, such as Shiny's own, is skipped.
 */
export function placeOf(frames: Frame[]): AppErrorPlace {
  const own = frames.filter((frame): frame is Required<Frame> => Boolean(frame.file && frame.line));
  const output = frames.map((frame) => /^output\$([\w.]+)/.exec(frame.call)?.[1]).find(Boolean);
  const reactive = frames.map((frame) => /^<reactive:([\w.]+)>/.exec(frame.call)?.[1]).find(Boolean);
  const observer = frames.some((frame) => /^observe(Event)?(Handler)?\b|^<observer/.test(frame.call));
  return {
    at: own[0] ? { call: own[0].call, file: own[0].file, line: own[0].line } : undefined,
    via: own.slice(1).map((frame) => ({ call: frame.call, file: frame.file, line: frame.line })),
    output,
    reactive,
    observer,
  };
}

/** The place in words, for the explanation, such as "line 9 of app.R, in
 * helper(), called from renderPlot on line 17, while drawing output$plot". */
export function describePlace(place: AppErrorPlace): string {
  const parts: string[] = [];
  if (place.at) {
    const name = place.at.file.split(/[\\/]/).pop();
    // A function of the app's own is named with its parentheses; Shiny's
    // own blocks, such as renderPlot, are named as they are written.
    const plain = /^[A-Za-z.][\w.]*$/.test(place.at.call);
    const inside = !plain ? "" : /^render|^reactive|^observe|^eventReactive/.test(place.at.call) ? `, in ${place.at.call}` : `, in ${place.at.call}()`;
    parts.push(`line ${place.at.line} of ${name}${inside}`);
  }
  const caller = place.via[0];
  if (caller) parts.push(`called from ${caller.call} on line ${caller.line}`);
  if (place.output) parts.push(`while drawing output$${place.output}`);
  else if (place.reactive) parts.push(`while computing the reactive ${place.reactive}`);
  else if (place.observer) parts.push("inside an observer");
  return parts.join(", ");
}
