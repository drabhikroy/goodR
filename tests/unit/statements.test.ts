import { describe, expect, it } from "vitest";
import { statementAt, statementRanges } from "../../src/lib/statements";

const ranges = (code: string) => statementRanges(code).map((range) => [range.from, range.to]);

describe("statementRanges", () => {
  it("treats each simple line as its own statement", () => {
    expect(ranges("x <- 1\ny <- 2\n\nx + y\n")).toEqual([[0, 0], [1, 1], [3, 3]]);
  });

  it("joins lines while a bracket is open", () => {
    expect(ranges("fit <- lm(mass ~ flipper,\n         data = penguins)\nsummary(fit)")).toEqual([[0, 1], [2, 2]]);
  });

  it("joins lines that end in an operator", () => {
    expect(ranges("ggplot(d, aes(x, y)) +\n  geom_col() +\n  theme_minimal()\nnext_line")).toEqual([[0, 2], [3, 3]]);
    expect(ranges("penguins |>\n  head()")).toEqual([[0, 1]]);
    expect(ranges("d %>%\n  filter(x > 1)")).toEqual([[0, 1]]);
  });

  it("joins a control header to a body on the next line", () => {
    expect(ranges("if (x > 1)\n{\n  y <- 2\n}\nz")).toEqual([[0, 3], [4, 4]]);
    expect(ranges("f <- function(a)\n  a + 1\nf(2)")).toEqual([[0, 1], [2, 2]]);
  });

  it("keeps a whole braced block together", () => {
    expect(ranges("for (i in 1:3) {\n  print(i)\n}\n")).toEqual([[0, 2]]);
  });

  it("attaches an else on its own line to its if", () => {
    expect(ranges("if (a) {\n  1\n}\nelse {\n  2\n}\nb")).toEqual([[0, 5], [6, 6]]);
  });

  it("carries an else at the end of a line on to its body, as R's parser does", () => {
    expect(ranges("if (a) b else\n  c\nd")).toEqual([[0, 1], [2, 2]]);
  });

  it("ignores brackets and operators inside strings and comments", () => {
    expect(ranges('x <- "(+"\ny <- 1 # trailing (\nz')).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it("keeps multi line strings and raw strings in one statement", () => {
    expect(ranges('msg <- "first\nsecond"\nnext')).toEqual([[0, 1], [2, 2]]);
    expect(ranges('q <- r"(a ) " b\nc)"\nnext')).toEqual([[0, 1], [2, 2]]);
  });

  it("runs an unfinished statement to the end of the file", () => {
    expect(ranges("broken(\nx <- 1")).toEqual([[0, 1]]);
  });

  // Found by comparing these ranges with R's own parser over 2,946 R files
  // installed with R packages, where two files used page breaks.
  it("skips the spaces R skips: a page break and the wide spaces Unicode defines", () => {
    expect(ranges("a <- 1\n\f\nb <- 2")).toEqual([[0, 0], [2, 2]]);
    expect(ranges("x <- c(1,\n\f 2)\ny")).toEqual([[0, 1], [2, 2]]);
    for (const space of ["\u1680", "\u2000", "\u2003", "\u2006", "\u2008", "\u200a", "\u205f", "\u3000"]) {
      expect(ranges(`a <- 1\n${space}\nb <- 2`)).toEqual([[0, 0], [2, 2]]);
    }
  });

  it("still treats characters R rejects as code, so the error R gives lands on its line", () => {
    // R refuses a no-break space, a figure space, and a zero width space,
    // so the line is sent and R says what is wrong with it.
    for (const odd of ["\u00a0", "\u2007", "\u200b", "\u202f"]) {
      expect(ranges(`a <- 1\n${odd}\nb <- 2`)).toEqual([[0, 0], [1, 1], [2, 2]]);
    }
  });
});

describe("statementAt", () => {
  const code = "# heading\nx <- c(1,\n  2)\n\ny <- 3";
  const all = statementRanges(code);

  it("finds the statement containing the cursor", () => {
    expect(statementAt(all, 2)).toEqual({ from: 1, to: 2 });
  });

  it("moves to the next statement from a comment or blank line", () => {
    expect(statementAt(all, 0)).toEqual({ from: 1, to: 2 });
    expect(statementAt(all, 3)).toEqual({ from: 4, to: 4 });
  });

  it("returns nothing past the last statement", () => {
    expect(statementAt(all, 9)).toBeNull();
  });
});

describe("statementRanges with escaped newlines", () => {
  it("counts a newline escaped inside a string", () => {
    expect(ranges('x <- "one\\\ntwo"\ny <- 2')).toEqual([[0, 1], [2, 2]]);
  });
});
