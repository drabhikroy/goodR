import { describe, expect, it } from "vitest";
import { packageProgress } from "../../src/lib/packages";

describe("packageProgress", () => {
  it("names each package as it downloads, then counts it done when unpacked", () => {
    const output = [
      "trying URL 'https://cran.rstudio.com/bin/macosx/big-sur-arm64/contrib/4.6/curl_6.0.1.tgz'",
      "trying URL 'https://cran.rstudio.com/bin/macosx/big-sur-arm64/contrib/4.6/future.apply_1.21.0.tgz'",
      "package ‘curl’ successfully unpacked and MD5 sums checked",
    ].join("\n");
    const progress = packageProgress(output);
    expect(progress.names).toEqual(["curl", "future.apply"]);
    expect(progress.done).toEqual(["curl"]);
    expect(progress.current).toBe("future.apply");
  });

  it("reads source builds and failures", () => {
    const output = ["* installing *source* package 'gt' ...", "* DONE (gt)", "* installing *source* package 'sf' ...", "Warning: installation of package 'sf' had non-zero exit status"].join("\n");
    const progress = packageProgress(output);
    expect(progress.done).toEqual(["gt"]);
    expect(progress.failed).toEqual(["sf"]);
    expect(progress.current).toBeNull();
  });

  it("counts a package Update all finds still behind as not updated, though a Mac said nothing as it went", () => {
    const output = [
      "trying URL 'https://cloud.r-project.org/bin/macosx/big-sur-arm64/contrib/4.6/mvtnorm_1.5-0.tgz'",
      "trying URL 'https://cloud.r-project.org/bin/macosx/big-sur-arm64/contrib/4.6/tm_0.7-20.tgz'",
      "Warning: cannot remove prior installation of package ‘tm’",
      "",
      "Still behind after the update: tm 0.7-18, rjags 4-18 ",
    ].join("\n");
    const progress = packageProgress(output);
    expect(progress.failed).toEqual(["tm", "rjags"]);
    expect(progress.names).toEqual(["mvtnorm", "tm", "rjags"]);
  });
});
