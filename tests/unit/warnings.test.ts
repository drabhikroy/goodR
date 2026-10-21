import { describe, expect, it } from "vitest";
import { explainWarning, splitWarnings, systemFix } from "../../src/lib/warnings";

describe("splitWarnings", () => {
  it("leaves text without warnings alone", () => {
    expect(splitWarnings("Loading required package: MASS\n")).toBeNull();
  });

  it("reads a warning from the top level, which names no call", () => {
    const split = splitWarnings("Warning message:\nNAs introduced by coercion \n");
    expect(split?.warnings).toEqual([{ call: "", message: "NAs introduced by coercion" }]);
  });

  it("reads a warning with its call on the line before the message", () => {
    const split = splitWarnings('Warning message:\nIn install.packages("xml2") :\n  installation of package ‘xml2’ had non-zero exit status\n');
    expect(split?.warnings).toEqual([{ call: 'install.packages("xml2")', message: "installation of package ‘xml2’ had non-zero exit status" }]);
  });

  it("reads numbered warnings and keeps what came before them", () => {
    const split = splitWarnings("Loading\nWarning messages:\n1: In sqrt(-1) : NaNs produced\n2: In log(-1) : NaNs produced\n");
    expect(split?.before).toBe("Loading\n");
    expect(split?.warnings.map((warning) => warning.call)).toEqual(["sqrt(-1)", "log(-1)"]);
  });

  it("reads a one line warning inside a function", () => {
    const split = splitWarnings("Warning in mean.default(letters) : argument is not numeric or logical: returning NA\n");
    expect(split?.warnings).toEqual([{ call: "mean.default(letters)", message: "argument is not numeric or logical: returning NA" }]);
  });

  it("reads the note R prints when there are too many to list", () => {
    const split = splitWarnings("There were 50 or more warnings (use warnings() to see the first 50)\n");
    expect(explainWarning(split!.warnings[0]).title).toBe("R gave 50 or more warnings");
  });
});

describe("explainWarning", () => {
  it("explains common warnings in plain words", () => {
    expect(explainWarning({ call: "", message: "NAs introduced by coercion" }).title).toBe("Some values could not be turned into numbers");
    expect(explainWarning({ call: "", message: "Removed 2 rows containing missing values or values outside the scale range (`geom_point()`)." }).title).toBe("2 rows were left out of the plot");
    expect(explainWarning({ call: "chisq.test(t)", message: "Chi-squared approximation may be incorrect" }).hint).toContain("fisher.test");
  });

  it("keeps R's words, and says something useful about the rest", () => {
    const explained = explainWarning({ call: "f(x)", message: "something odd happened" });
    expect(explained.title).toBe("R gave a warning");
    expect(explained.original).toBe("In f(x) : something odd happened");
  });

  it("finds the system library a failed install needs, as a command for this computer", () => {
    const log = "Configuration failed because libxml-2.0 was not found. Try installing:\n * deb: libxml2-dev (Debian, Ubuntu, etc)\n * rpm: libxml2-devel (Fedora, CentOS, RHEL)\n * brew: libxml2 (Mac OSX)\n";
    const warning = { call: 'install.packages("xml2")', message: "installation of package ‘xml2’ had non-zero exit status" };
    const mac = explainWarning(warning, log, "macos");
    expect(mac.title).toBe("xml2 did not install");
    expect(mac.system?.command).toBe("brew install libxml2");
    expect(explainWarning(warning, log, "linux").system?.command).toBe("sudo apt install libxml2-dev");
  });

  it("recognizes a missing header and the compilers themselves", () => {
    expect(systemFix("fatal error: 'ft2build.h' file not found", "macos")?.command).toBe("brew install freetype");
    expect(systemFix("xcrun: error: invalid active developer path", "macos")?.command).toBe("xcode-select --install");
    expect(systemFix("gdal-config: not found", "linux")?.command).toBe("sudo apt install libgdal-dev");
    expect(systemFix("all fine", "macos")).toBeNull();
  });
});
