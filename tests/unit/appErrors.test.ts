import { describe, expect, it } from "vitest";
import { explainApp, explainProblem } from "../../src/lib/appErrors";

// An app whose second line has two names side by side, which R's parser
// reports as "4:6: unexpected symbol", counting from one.
const APP = ["library(shiny)", "", "ui <- fluidPage(", "  title panel", ")", "server <- function(input, output) {}", "shinyApp(ui, server)", ""].join("\n");

describe("explainApp", () => {
  it("marks the spot of a syntax error in the file R named", () => {
    const files: Record<string, string> = { "/work/app.R": APP };
    const explained = explainApp({ kind: "parse", file: "/work/app.R", line: 4, column: 9, message: "unexpected symbol" }, (file) => files[file] ?? "");
    // Line 4 of the file, counted from zero.
    expect(explained.where).toEqual({ file: "/work/app.R", line: 3, text: "panel", from: 8 });
    expect(explained.original).toBe("app.R:4:9: unexpected symbol");
    expect(explained.action).toEqual({ label: "Run again", kind: "again" });
  });

  it("explains a syntax error even when the file is not open", () => {
    const explained = explainApp({ kind: "parse", file: "/work/ui.R", line: 3, column: 0, message: "unexpected end of input" }, () => "");
    expect(explained.title).toBe("The code stops before it is finished");
    expect(explained.where).toBeUndefined();
    expect(explained.original).toBe("ui.R:3:0: unexpected end of input");
  });

  it("says apps start clean when a name made in the console is missing", () => {
    const explained = explainApp({ kind: "ended", message: "object 'server' not found" }, () => "");
    expect(explained.title).toBe("R could not find “server”");
    expect(explained.detail).toContain("Apps run from a clean start");
    expect(explained.original).toBe("object 'server' not found");
  });

  it("offers to install shiny, or a package the app loads", () => {
    expect(explainApp({ kind: "noShiny" }, () => "").action).toEqual({ label: "Install shiny", kind: "install", name: "shiny" });
    expect(explainApp({ kind: "ended", message: "there is no package called 'bslib'" }, () => "").action).toEqual({ label: "Install bslib", kind: "install", name: "bslib" });
  });

  it("offers a way forward when R is missing or the app was stopped", () => {
    expect(explainApp({ kind: "noR" }, () => "").action?.kind).toBe("chooseR");
    const stopped = explainApp({ kind: "stopped" }, () => "");
    expect(stopped.title).toBe("The app stopped");
    expect(stopped.action?.kind).toBe("again");
  });
});

describe("explainProblem", () => {
  it("explains an error inside a running app in the console's words", () => {
    const explained = explainProblem("object 'bins' not found");
    expect(explained.title).toBe("R could not find “bins”");
    expect(explained.detail).toContain("clean start");
    expect(explained.action).toBeUndefined();
  });
});

describe("sharing an app", () => {
  it("offers to install shinylive when it is missing", () => {
    const explained = explainApp({ kind: "noShinylive" }, () => "");
    expect(explained.title).toBe("The shinylive package is not installed yet");
    expect(explained.action).toEqual({ label: "Install shinylive", kind: "install", name: "shinylive" });
  });
});
