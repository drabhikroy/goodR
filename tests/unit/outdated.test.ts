import { describe, expect, it } from "vitest";
import { findOutdated, fixesFromWarnings } from "../../src/lib/outdated";

describe("findOutdated", () => {
  it("offers a fix only for plain renames", () => {
    const code = [
      "ggplot(stars, aes(x, y)) + geom_line(size = 2) + geom_point(size = 3)",
      "long <- gather(stars, key, value)",
      "df <- data_frame(a = 1)",
      'stat_summary(fun.y = mean, geom = "point") + guides(fill = FALSE)',
      "ggplot(stars, aes(x, ..count..))",
    ].join("\n");
    const hints = findOutdated(code);
    const fixes = hints.filter((hint) => hint.fix).map((hint) => `${hint.line}:${hint.fix}`);
    expect(fixes).toEqual(["0:linewidth", "2:tibble", "3:fun", '3:"none"', "4:after_stat(count)"]);
    expect(hints.find((hint) => hint.line === 1)?.title).toBe("gather() is retired");
    // size for points is still size.
    expect(hints.filter((hint) => hint.line === 0)).toHaveLength(1);
  });

  it("leaves a column called size alone", () => {
    expect(findOutdated("stars$size <- 1\nmutate(stars, size = 2)")).toEqual([]);
  });
});

describe("fixesFromWarnings", () => {
  it("reads lifecycle warnings for functions and arguments", () => {
    const warning = "Warning message:\n`summarise_at()` was deprecated in dplyr 1.1.0.\nℹ Please use `summarise()` instead.\nThe `fn` argument of `foo()` is deprecated as of mypkg 2.0.\nℹ Please use the `f` argument instead."; // standards: dplyr's own name
    const hints = fixesFromWarnings("x <- summarise_at(df, 1)\nfoo(fn = 2)", warning); // standards: dplyr's own name
    expect(hints.map((hint) => `${hint.line}:${hint.from}:${hint.fix}`)).toEqual(["0:5:summarise", "1:4:f"]); // standards: dplyr's own name
  });
});
