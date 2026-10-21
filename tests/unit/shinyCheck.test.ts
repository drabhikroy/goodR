import { describe, expect, it } from "vitest";
import { checkShinyApp, tokenize } from "../../src/lib/shinyCheck";
import { describePlace, parseFrame, placeOf } from "../../src/lib/shinyTrace";
import exampleApp from "../../examples/shiny-launches/app.R?raw";
import basicApp from "../../examples/shiny-basic/app.R?raw";
import mistakesApp from "../../examples/shiny-mistakes/app.R?raw";

const app = (text: string) => checkShinyApp([{ file: "app.R", text }]);
const titles = (text: string) => app(text).map((finding) => finding.title);

const GOOD = `library(shiny)
ui <- fluidPage(
  sliderInput("bins", "Bins", 5, 50, 20),
  plotOutput("plot")
)
server <- function(input, output, session) {
  data <- reactive(faithful$waiting)
  output$plot <- renderPlot({
    hist(data(), breaks = input$bins)
  })
}
shinyApp(ui, server)
`;

describe("checkShinyApp", () => {
  it("finds nothing wrong with a correct app", () => {
    expect(app(GOOD)).toEqual([]);
  });

  it("finds an output id spelled differently in the server, with a fix", () => {
    const [finding] = app(GOOD.replace("output$plot", "output$plt"));
    expect(finding.title).toBe("output$plt has no place in the UI");
    expect(finding.line).toBe(7);
    expect(finding.fix).toMatchObject({ label: "Change to plot", text: "plot", line: 7, from: 9, to: 12 });
  });

  it("finds an input read under a name the UI does not have", () => {
    const [finding] = app(GOOD.replace("input$bins", "input$bin"));
    expect(finding.title).toBe("The UI has no input called bin");
    expect(finding.fix?.text).toBe("bins");
    expect(finding.line).toBe(8);
  });

  it("finds a reactive used without its parentheses", () => {
    const [finding] = app(GOOD.replace("hist(data(),", "hist(data,"));
    expect(finding.title).toBe("data is a reactive, so it is read as data()");
    expect(finding.fix?.text).toBe("data()");
    expect(finding.line).toBe(8);
  });

  it("finds an input read outside any reactive in the server", () => {
    const code = GOOD.replace("  data <- reactive(faithful$waiting)", "  n <- input$bins * 2\n  data <- reactive(faithful$waiting)");
    expect(titles(code)).toEqual(["input$bins is read outside a reactive"]);
  });

  it("leaves inputs read inside helper functions alone", () => {
    const code = GOOD.replace("  data <- reactive(faithful$waiting)", "  pick <- function() input$bins\n  data <- reactive(faithful$waiting)");
    expect(app(code)).toEqual([]);
  });

  it("finds an output assigned without a render function", () => {
    expect(titles(GOOD.replace("renderPlot({", "({"))).toContain("output$plot needs a render function");
  });

  it("finds a render function that does not suit its output, and fixes the UI call", () => {
    const [finding] = app(GOOD.replace('plotOutput("plot")', 'textOutput("plot")'));
    expect(finding.title).toBe("textOutput cannot show renderPlot");
    expect(finding.fix).toMatchObject({ text: "plotOutput", line: 3, from: 2, to: 12 });
  });

  it("finds an id used twice", () => {
    expect(titles(GOOD.replace('plotOutput("plot")', 'plotOutput("plot"),\n  textOutput("bins")'))).toContain("The id bins is used twice");
  });

  it("checks ui.R and server.R together", () => {
    const findings = checkShinyApp([
      { file: "ui.R", text: 'fluidPage(sliderInput("n", "N", 1, 9, 3), plotOutput("hist"))' },
      { file: "server.R", text: "function(input, output) {\n  output$hist <- renderPlot(hist(rnorm(input$m)))\n}" },
    ]);
    expect(findings.map((finding) => [finding.file, finding.title])).toEqual([["server.R", "The UI has no input called m"]]);
  });

  it("stays quiet about ids it cannot read, as in modules", () => {
    expect(app(GOOD.replace("output$plot", "output$plt").replace("library(shiny)", 'library(shiny)\nns <- NS("a")'))).toEqual([]);
  });
});

describe("Shiny stack traces", () => {
  const trace = [
    "  169: helper [/tmp/sapp/app.R#9]",
    "  168: renderPlot [/tmp/sapp/app.R#17]",
    "  166: func",
    "  126: drawPlot",
    "  112: <reactive:plotObj>",
    "   82: output$plot",
    "    1: shiny::runApp",
  ];

  it("reads frames with and without a place", () => {
    expect(parseFrame(trace[0])).toEqual({ call: "helper", file: "/tmp/sapp/app.R", line: 9 });
    expect(parseFrame(trace[5])).toEqual({ call: "output$plot" });
    expect(parseFrame("Listening on http://127.0.0.1:7781")).toBeNull();
  });

  it("finds the failing line, the call that led there, and the output", () => {
    const place = placeOf(trace.map((line) => parseFrame(line)!));
    expect(place.at).toEqual({ call: "helper", file: "/tmp/sapp/app.R", line: 9 });
    expect(place.via[0]).toEqual({ call: "renderPlot", file: "/tmp/sapp/app.R", line: 17 });
    expect(place.output).toBe("plot");
    expect(describePlace(place)).toBe("line 9 of app.R, in helper(), called from renderPlot on line 17, while drawing output$plot");
  });
});

describe("the example app", () => {
  it("has nothing wrong", () => {
    expect(checkShinyApp([{ file: "app.R", text: exampleApp }])).toEqual([]);
  });
});

describe("Shiny's own messages", () => {
  it("explain an input read outside a reactive", async () => {
    const { explainError } = await import("../../src/lib/errors");
    // Shiny's own words, put together so the contraction is not in this file.
    const message = ["Can", "t access reactive value 'bins' outside of reactive consumer."].join("'");
    const explained = explainError(message, [], "");
    expect(explained.title).toBe("input$bins was read outside a reactive");
  });
});

describe("the Shiny examples", () => {
  it("finds nothing wrong with the basic app", () => {
    expect(app(basicApp)).toEqual([]);
  });

  // The app with mistakes on purpose promises four, so the checker has to
  // find exactly those, or the example would mislead.
  it("finds each of the four mistakes planted in the mistakes app", () => {
    expect(titles(mistakesApp).sort()).toEqual(
      [
        "The id method is used twice",
        "found is a reactive, so it is read as found()",
        "input$rows is read outside a reactive",
        "output$sumary has no place in the UI",
      ].sort(),
    );
  });
});

describe("tokenize, raw strings and numbers", () => {
  it("reads a raw string with quotes inside as one string", () => {
    const tokens = tokenize('x <- r"(say "hi")" + 1e-5');
    expect(tokens.map((token) => token.kind)).toEqual(["ident", "op", "string", "op", "number"]);
    expect(tokens[2].value).toBe('say "hi"');
  });
});
