import { describe, expect, it } from "vitest";
import { connected, shinyGraph } from "../../src/lib/shinyGraph";
import mistakesApp from "../../examples/shiny-mistakes/app.R?raw";

const APP = `library(shiny)
ui <- fluidPage(
  sliderInput("bins", "Bins", 5, 50, 20),
  actionButton("go", "Count"),
  plotOutput("plot"),
  textOutput("count")
)
server <- function(input, output, session) {
  data <- reactive(faithful$waiting[seq_len(input$bins * 10)])
  clicks <- reactiveVal(0)
  observeEvent(input$go, {
    clicks(clicks() + 1)
  })
  output$plot <- renderPlot(hist(data(), breaks = input$bins))
  output$count <- renderText(clicks())
}
shinyApp(ui, server)
`;

describe("shinyGraph", () => {
  const graph = shinyGraph([{ file: "app.R", text: APP }]);

  it("finds the inputs, reactives, observers, and outputs, in that order", () => {
    expect(graph.nodes.map((node) => node.label)).toEqual(["input$bins", "input$go", "data()", "clicks()", "observeEvent, line 11", "output$plot", "output$count"]);
  });

  it("joins each part to what it reads, and an observer to what it sets", () => {
    const edges = graph.edges.map((edge) => `${edge.from} ${edge.sets ? "sets" : "to"} ${edge.to}`);
    expect(edges).toContain("input:bins to reactive:data");
    expect(edges).toContain("input:bins to output:plot");
    expect(edges).toContain("reactive:data to output:plot");
    expect(edges).toContain("input:go to observer:app.R:10");
    expect(edges).toContain("observer:app.R:10 sets reactive:clicks");
    expect(edges).toContain("reactive:clicks to output:count");
  });

  it("follows a path both ways, for highlighting", () => {
    const path = connected(graph, "output:count");
    expect([...path].sort()).toEqual(["input:go", "observer:app.R:10", "output:count", "reactive:clicks"]);
    expect(connected(graph, "input:bins").has("output:count")).toBe(false);
  });

  it("shows an input read in the server even when the UI never makes it", () => {
    const labels = shinyGraph([{ file: "app.R", text: mistakesApp }]).nodes.map((node) => node.label);
    expect(labels).toContain("input$rows");
    expect(labels).toContain("output$sumary");
  });
});
