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
});
