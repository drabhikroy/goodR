import { describe, expect, it } from "vitest";
import { formatLine } from "../../src/lib/formatLine";

describe("tidying a line as it is finished", () => {
  it("spaces operators and commas the tidyverse way", () => {
    expect(formatLine("x<-c(1,2,3)")).toBe("x <- c(1, 2, 3)");
    expect(formatLine("fit<-lm(y~x,data=df)")).toBe("fit <- lm(y ~ x, data = df)");
    expect(formatLine("df |>filter(mass>10&!is.na(id))")).toBe("df |> filter(mass > 10 & !is.na(id))");
    expect(formatLine("x %>%  head( 3 )")).toBe("x %>% head(3)");
  });

  it("keeps tight operators tight and unary signs on their values", () => {
    expect(formatLine("y <- df$col[1 : 10]^2")).toBe("y <- df$col[1:10]^2");
    expect(formatLine("c(-1, +2) - 3")).toBe("c(-1, +2) - 3");
    expect(formatLine("dplyr :: filter(x)")).toBe("dplyr::filter(x)");
    expect(formatLine("x[1,]")).toBe("x[1, ]");
  });

  it("writes if and for with a space before the bracket, and function without", () => {
    expect(formatLine("if(x>1){")).toBe("if (x > 1) {");
    expect(formatLine("sq <- function (x) x*x")).toBe("sq <- function(x) x * x");
    expect(formatLine("sq <- \\(x)x^2")).toBe("sq <- \\(x) x^2");
  });

  it("never changes strings, comments, names in backquotes, or indentation", () => {
    expect(formatLine('    paste("a,b",x)  # keep,this')).toBe('    paste("a,b", x)  # keep,this');
    expect(formatLine("`my col`<-1")).toBe("`my col` <- 1");
    expect(formatLine("# a,b<-c")).toBe("# a,b<-c");
    expect(formatLine('x <- "unfinished')).toBe('x <- "unfinished');
    expect(formatLine('r"(a, b)"')).toBe('r"(a, b)"');
  });
});

describe("formatLine and assignment operators", () => {
  it("keeps := whole", () => {
    expect(formatLine("dt[, a:=b]")).toBe("dt[, a := b]");
  });
});
