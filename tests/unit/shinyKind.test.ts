import { describe, expect, it } from "vitest";
import { shinyCheckKind } from "../../src/lib/shiny";

// The check reads each kind of file in its own way, and leaves alone the
// files that are not part of an app.
describe("shinyCheckKind", () => {
  it("reads an app file as an app", () => {
    expect(shinyCheckKind("/p/app/app.R", "")).toBe("app");
    expect(shinyCheckKind("/p/app/server.R", "function(input, output) {}")).toBe("app");
    expect(shinyCheckKind("/p/explore.R", "ui <- fluidPage()\nshinyApp(ui, server)")).toBe("app");
  });

  it("reads a helper in an R folder as part of its app", () => {
    expect(shinyCheckKind("/p/app/R/screens.R", 'screen <- function() plotOutput("x")')).toBe("part");
    // A plain function in an R folder has nothing to check.
    expect(shinyCheckKind("/p/app/R/math.R", "elo <- function(a, b) a - b")).toBeNull();
  });

  it("reads a document only when it runs Shiny", () => {
    expect(shinyCheckKind("/p/explore.Rmd", '---\ntitle: "x"\nruntime: shiny\n---\n')).toBe("document");
    expect(shinyCheckKind("/p/explore.qmd", '---\ntitle: "x"\nserver: shiny\n---\n')).toBe("document");
    expect(shinyCheckKind("/p/report.qmd", '---\ntitle: "x"\nformat: html\n---\n```{r}\ninput <- 1\n```\n')).toBeNull();
  });

  it("leaves an ordinary script alone, even one that mentions output$", () => {
    expect(shinyCheckKind("/p/analysis.R", "output$table <- summary(fit)")).toBeNull();
    expect(shinyCheckKind("untitled:1", "shinyApp(ui, server)")).toBeNull();
  });
});
