import { describe, expect, it } from "vitest";
import { shortPath } from "../../src/lib/app";

describe("shortPath", () => {
  it("shows the home folder as ~", () => {
    expect(shortPath("/Users/ana/Documents/survey")).toBe("~/Documents/survey");
    expect(shortPath("/home/ana/work")).toBe("~/work");
  });

  it("names iCloud Drive as Finder does", () => {
    expect(shortPath("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Thesis/analysis.R")).toBe("iCloud Drive/Thesis/analysis.R");
    expect(shortPath("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs")).toBe("iCloud Drive");
  });

  it("names another app's iCloud folder by the app", () => {
    expect(shortPath("/Users/ana/Library/Mobile Documents/iCloud~com~apple~Pages/Documents/notes.R")).toBe("iCloud Drive/Pages/notes.R");
  });

  it("leaves other paths alone", () => {
    expect(shortPath("/Users/ana/Library/Mobile Documents/iCloud~com~apple~Pages/Data/x.R")).toBe("~/Library/Mobile Documents/iCloud~com~apple~Pages/Data/x.R");
    expect(shortPath("/opt/data")).toBe("/opt/data");
  });
});
