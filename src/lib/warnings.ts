// Warnings in plain words, the way errors already are.
//
// A warning means the line ran, but R noticed something worth a look:
// text that would not turn into numbers, rows a plot left out, a package
// that failed to install. R prints them after the output, in the same red
// as errors in most consoles, with jargon such as "NAs introduced by
// coercion". People either take them for failures or learn to skip them,
// and both are costly. Each one here gets a short headline, a plain
// reason, and one thing to try, with R's own words kept one press away.
//
// A failed package install is a warning too. Its real cause is usually
// further up the install log: a system library the package needs is not
// on this computer. That cause is found in the log and turned into the
// exact command that installs it, for the system the app is running on.
//
// It depends on nothing, so it can be tested alone.

/** One warning R printed: the call it came from, when R named one, and
 * its message. */
export type RWarning = { call: string; message: string };

/** A command that fixes the cause, ready to copy into a terminal. */
export type SystemFix = { what: string; command: string | null; note: string };

export type ExplainedWarning = {
  title: string;
  detail: string;
  hint?: string;
  /** What to install on the computer itself, for a failed package. */
  system?: SystemFix;
  original: string;
};

/** Text R printed to its error stream, split into what came before the
 * warnings, such as an install log, and the warnings themselves. */
export type SplitStream = { before: string; warnings: RWarning[]; after: string };

// R starts its warnings with one of these lines at the top level.
const HEADER = /^(?:Warning messages?:|Warning in .+? :.*|Warning:)\s*$/m;
// "There were 12 warnings (use warnings() to see them)".
const MANY = /^There (?:were|was) (\d+|\d+ or more) warnings? \(use warnings\(\)[^\n]*\)\s*$/m;

/**
 * Finds the warnings in text from R's error stream. Messages that are not
 * warnings, such as a package saying it is loading, are left as they are.
 */
export function splitWarnings(text: string): SplitStream | null {
  const many = MANY.exec(text);
  const header = HEADER.exec(text);
  if (!header && !many) return null;
  if (!header && many) {
    return { before: text.slice(0, many.index), warnings: [{ call: "", message: many[0].trim() }], after: text.slice(many.index + many[0].length) };
  }
  const start = header!.index;
  // A one line header, "Warning in f(x) : message", carries its own text.
  const inline = /^Warning in (.+?) :\s*(.*)$/.exec(header![0].trim());
  const warnings: RWarning[] = [];
  let current: RWarning | null = inline ? { call: inline[1], message: inline[2] } : null;
  const finish = () => {
    if (current?.message) warnings.push(current);
    current = null;
  };
  const lines = text.slice(start + header![0].length).replace(/^\n/, "").split("\n");
  let used = 0;
  for (const line of lines) {
    const withCall = /^(?:\d+:\s*)?In (.+?) :\s*(.*)$/.exec(line);
    const numbered = /^\d+:\s*(.+)$/.exec(line);
    if (withCall) {
      finish();
      current = { call: withCall[1], message: withCall[2].trim() };
    } else if (numbered || MANY.test(line)) {
      finish();
      current = { call: "", message: (numbered ? numbered[1] : line).trim() };
    } else if (line.trim() && (/^\s/.test(line) || !current || !current.message)) {
      // A message continues, indented, on the lines after its call, and a
      // warning from the top level has no call at all.
      current = current ?? { call: "", message: "" };
      current.message = `${current.message} ${line.trim()}`.trim();
    } else {
      // A blank line, or text that is not part of a warning, ends them.
      if (line.trim() || warnings.length || current) break;
    }
    used += line.length + 1;
  }
  finish();
  const end = Math.min(text.length, start + header![0].length + 1 + used);
  return { before: text.slice(0, start), warnings, after: text.slice(end) };
}

type Rule = { test: RegExp; make: (match: RegExpExecArray, log: string, platform: string) => Omit<ExplainedWarning, "original"> };

// The rules, roughly in order of how often people meet each warning.
const RULES: Rule[] = [
  {
    test: /NAs introduced by coercion/,
    make: () => ({
      title: "Some values could not be turned into numbers",
      detail: 'R was asked to treat text as numbers. Values that are not numbers, such as "n/a" or "12 kg", became NA, which means missing.',
      hint: "Look at the values that became missing, then clean them before converting. x[is.na(as.numeric(x))] lists them.",
    }),
  },
  {
    test: /NaNs produced/,
    make: () => ({
      title: "Some results are not numbers",
      detail: "A calculation had no answer, such as the square root or the log of a negative number, so R gave NaN, short for not a number.",
      hint: "Check for negative or zero values before taking a log or a square root.",
    }),
  },
  {
    test: /longer object length is not a multiple of shorter object length/,
    make: () => ({
      title: "Two sets of values have lengths that do not fit",
      detail: "R matched a shorter set to a longer one by repeating it from the start. That is rarely what was meant, and the result may be wrong.",
      hint: "Check the length of each with length().",
    }),
  },
  {
    test: /number of items to replace is not a multiple of replacement length/,
    make: () => ({
      title: "The new values do not fit the space they went into",
      detail: "More or fewer values were given than the places being filled, so R repeated or cut them.",
      hint: "Check that the values on the right of <- are as many as the places on the left.",
    }),
  },
  {
    test: /Removed (\d+) rows? containing (?:missing|non-finite) values/,
    make: ([, count]) => ({
      title: `${count} ${count === "1" ? "row was" : "rows were"} left out of the plot`,
      detail: "Those rows have a missing value, or a value outside the axis limits, in something the plot uses. The rest of the plot is fine.",
      hint: "If the rows matter, look for missing values with summary(), or widen the axis limits.",
    }),
  },
  {
    test: /installation of package [‘'"](.+?)[’'"] had non-zero exit status/,
    make: ([, name], log, platform) => {
      const system = systemFix(log, platform);
      return {
        title: `${name} did not install`,
        detail: system
          ? `${name} needs ${system.what}, which is not on this computer yet. R cannot install it, since it is not an R package.`
          : `Something went wrong while building ${name}. The install log above it says what, usually near its end.`,
        hint: system ? system.note : `Try again with install.packages("${name}"). If it fails the same way, search the last lines of the log online.`,
        system: system ?? undefined,
      };
    },
  },
  {
    test: /package [‘'"](.+?)[’'"] is not available (?:for|as a binary package for) (?:this version of R|R version [\d.]+)/,
    make: ([, name]) => ({
      title: `There is no package called ${name} for this R`,
      detail: "CRAN has no package by that name for the version of R in use. The name may be misspelled, since capitals count, or the package may live on GitHub instead.",
      hint: "Check the spelling on cran.r-project.org.",
    }),
  },
  {
    test: /package [‘'"](.+?)[’'"] was built under R version ([\d.]+)/,
    make: ([, name, version]) => ({
      title: `${name} was made for a newer R`,
      detail: `${name} was built for R ${version}. It almost always works anyway.`,
      hint: "Update R from CRAN when it suits you, then reinstall the package.",
    }),
  },
  {
    test: /fitted probabilities numerically 0 or 1 occurred/,
    make: () => ({
      title: "The model predicts some cases with certainty",
      detail: "One of the variables separates the outcomes perfectly, or almost. The estimates for that variable can be very large and unreliable.",
      hint: "Look at a table of the outcome against each predictor to find the one that separates them.",
    }),
  },
  {
    test: /algorithm did not converge/,
    make: () => ({
      title: "The model did not settle on an answer",
      detail: "The fitting steps stopped before the estimates stopped changing, so they may not be the best fit.",
      hint: "Check for variables on very different scales, or for perfect separation, and try again.",
    }),
  },
  {
    test: /Chi-squared approximation may be incorrect/,
    make: () => ({
      title: "Some groups are too small for this test",
      detail: "The chi-squared test needs a few cases expected in every cell of the table. Some cells here expect fewer than five.",
      hint: "fisher.test() gives an exact answer for small tables.",
    }),
  },
  {
    test: /essentially perfect fit/,
    make: () => ({
      title: "The model fits the data perfectly",
      detail: "A perfect fit usually means the outcome is also among the predictors, or there are as many variables as rows.",
      hint: "Check the formula for the outcome on both sides.",
    }),
  },
  {
    test: /invalid factor level, NA generated/,
    make: () => ({
      title: "A value is not one of the column's categories",
      detail: "The column is a factor, which only holds the categories it already has. The new value was not one of them, so it became NA.",
      hint: "Add the category first with levels(), or convert the column to text with as.character().",
    }),
  },
  {
    test: /argument is not numeric or logical: returning NA/,
    make: () => ({
      title: "The function was given something that is not numbers",
      detail: "It needs numbers, such as a numeric column, and got text, categories, or a whole table, so it gave NA.",
      hint: "Pass one numeric column, such as mean(data$column).",
    }),
  },
  {
    test: /There (?:were|was) (\d+(?: or more)?) warnings?/,
    make: ([, count]) => ({
      title: `R gave ${count} warnings`,
      detail: "There were too many to print one by one.",
      hint: "Run warnings() to see them.",
    }),
  },
];

/** Explains one warning. `log` is everything the run printed, where the
 * cause of a failed install is found. `platform` is the system the app is
 * running on, which decides the install command offered. */
export function explainWarning(warning: RWarning, log = "", platform = "macos"): ExplainedWarning {
  const original = warning.call ? `In ${warning.call} : ${warning.message}` : warning.message;
  for (const rule of RULES) {
    const match = rule.test.exec(warning.message);
    if (match) return { ...rule.make(match, log, platform), original };
  }
  return {
    title: "R gave a warning",
    detail: `The line ran, but R noticed something that may be worth a look: ${warning.message}`,
    original,
  };
}

// System libraries packages often need, with the package that provides
// each through Homebrew on a Mac and apt on Debian and Ubuntu. Keys are
// matched against the names R's install log uses.
const LIBRARIES: { match: RegExp; what: string; brew: string; apt: string }[] = [
  { match: /libxml-?2|libxml\/|xml2-config/, what: "libxml2", brew: "libxml2", apt: "libxml2-dev" },
  { match: /openssl|ssl\.h/, what: "OpenSSL", brew: "openssl", apt: "libssl-dev" },
  { match: /libcurl|curl\/curl\.h|curl-config/, what: "libcurl", brew: "curl", apt: "libcurl4-openssl-dev" },
  { match: /freetype|ft2build\.h/, what: "FreeType", brew: "freetype", apt: "libfreetype6-dev" },
  { match: /harfbuzz|hb\.h/, what: "HarfBuzz", brew: "harfbuzz", apt: "libharfbuzz-dev" },
  { match: /fribidi/, what: "FriBidi", brew: "fribidi", apt: "libfribidi-dev" },
  { match: /fontconfig/, what: "Fontconfig", brew: "fontconfig", apt: "libfontconfig1-dev" },
  { match: /libpng|png\.h/, what: "libpng", brew: "libpng", apt: "libpng-dev" },
  { match: /libjpeg|jpeglib\.h/, what: "libjpeg", brew: "jpeg", apt: "libjpeg-dev" },
  { match: /libtiff|tiff\.h/, what: "libtiff", brew: "libtiff", apt: "libtiff5-dev" },
  { match: /gdal-config|gdal/, what: "GDAL", brew: "gdal", apt: "libgdal-dev" },
  { match: /geos-config|geos_c\.h|\bgeos\b/, what: "GEOS", brew: "geos", apt: "libgeos-dev" },
  { match: /\bproj\b|proj\.h/, what: "PROJ", brew: "proj", apt: "libproj-dev" },
  { match: /udunits/, what: "UDUNITS", brew: "udunits", apt: "libudunits2-dev" },
  { match: /\bgmp\b|gmp\.h/, what: "GMP", brew: "gmp", apt: "libgmp-dev" },
  { match: /sodium/, what: "libsodium", brew: "libsodium", apt: "libsodium-dev" },
  { match: /\blibuv\b|uv\.h/, what: "libuv", brew: "libuv", apt: "libuv1-dev" },
  { match: /libgit2|git2\.h/, what: "libgit2", brew: "libgit2", apt: "libgit2-dev" },
  { match: /pkg-config/, what: "pkg-config", brew: "pkg-config", apt: "pkg-config" },
];

/** The system software a failed install needs, read from its log, with
 * the command that installs it on this computer. */
export function systemFix(log: string, platform: string): SystemFix | null {
  const windows = platform === "windows";
  const linux = platform === "linux";
  // The compilers themselves come first, since nothing builds without them.
  if (/xcrun: error|invalid active developer path|make: (?:command )?not found/.test(log) && !windows && !linux) {
    return { what: "Apple's command line tools", command: "xcode-select --install", note: "Run this in Terminal, follow the window that opens, then install the package again." };
  }
  if (/gfortran[^\n]*(?:No such file|not found)|cannot find -lgfortran/.test(log)) {
    if (linux) return { what: "a Fortran compiler", command: "sudo apt install gfortran", note: "Run this in a terminal, then install the package again." };
    return { what: "a Fortran compiler", command: null, note: "R's own tools page, mac.r-project.org/tools, has the Fortran compiler for this Mac. Install it, then install the package again." };
  }
  if (windows && /Rtools|make: not found|'make' not found/.test(log)) {
    return { what: "Rtools", command: null, note: "Install Rtools for this version of R from cran.r-project.org/bin/windows/Rtools, then install the package again." };
  }
  // A package's configure script often names what to install, as in
  // "Configuration failed because libxml-2.0 was not found. Try installing:
  //  * deb: libxml2-dev  * brew: libxml2".
  const suggested = linux ? /\*\s*deb:\s*([\w.+-]+)/.exec(log) : /\*\s*brew:\s*([\w.+@-]+)/.exec(log);
  const missing =
    /Configuration failed because ([\w.+-]+) was not found/.exec(log)?.[1] ??
    /Package [‘'"]?([\w.+-]+)[’'"]? was not found in the pkg-config search path/.exec(log)?.[1] ??
    /fatal error: [‘'"<]?([\w./+-]+\.h)[’'">]?:? (?:file not found|No such file)/.exec(log)?.[1] ??
    /([\w-]+-config):? (?:command )?not found/.exec(log)?.[1] ??
    null;
  if (!missing && !suggested) return null;
  const known = LIBRARIES.find((library) => library.match.test(missing ?? suggested?.[1] ?? ""));
  const name = suggested?.[1] ?? (known ? (linux ? known.apt : known.brew) : null);
  const what = known?.what ?? missing ?? suggested?.[1] ?? "a system library";
  if (windows) return { what, command: null, note: "On Windows, packages usually install ready made. Make sure Rtools is installed, then try again." };
  if (!name) return { what, command: null, note: `Install ${what} with your system's package manager, then install the package again.` };
  return linux
    ? { what, command: `sudo apt install ${name}`, note: "Run this in a terminal, then install the package again. On Fedora and similar systems, use dnf and the -devel package instead." }
    : { what, command: `brew install ${name}`, note: "Run this in Terminal, then install the package again. It needs Homebrew, from brew.sh." };
}

/** The headline of the first warning in text from R's error stream, for a
 * short preview such as the timeline's, or null when there is none. */
export function firstWarningTitle(text: string, platform = "macos"): string | null {
  const split = splitWarnings(text);
  return split?.warnings.length ? explainWarning(split.warnings[0], text, platform).title : null;
}
