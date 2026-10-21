#!/usr/bin/env node
// The house writing standards gate. It reads every source, script, and
// document file and fails the build on any of the following:
//
//   1. An em dash or en dash anywhere, including code and comments.
//   2. A contraction in prose, comments, or interface text.
//   3. A word from the banned lexicon, in any inflection.
//   4. A British spelling where the American one is standard.
//   5. A logic file whose comments fall below 15 percent of its lines.
//
// Usage: node scripts/standards/check.mjs [--quiet]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BRITISH } from "./spelling.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "gen", "binaries", "test-results", "playwright-report"]);
const CHECKED = new Set([".ts", ".tsx", ".css", ".rs", ".mjs", ".py", ".md", ".yml", ".yaml", ".html", ".json", ".toml", ".sh", ".R", ".plist"]);
// Generated or third party files that the project does not author. The
// license is the PolyForm text, reproduced word for word.
const EXEMPT = [/LICENSE\.md$/, /package-lock\.json$/, /Cargo\.lock$/, /src-tauri\/resources\//, /schemas\//];

// Logic files carry the comment density floor. Markup, styles, data, and
// tests are excluded because their comments would only restate the code.
const LOGIC = new Set([".rs", ".ts", ".mjs", ".py"]);
const DENSITY_FLOOR = 0.15;
const DENSITY_MIN_LINES = 40;

const BANNED = [
  /\bactionable\b/i,
  /\brobust(?:ly|ness)?\b/i,
  /\bensur(?:e|es|ed|ing)\b/i,
  /\bleverag(?:e|es|ed|ing)\b/i,
  /\butiliz(?:e|es|ed|ing|ation)\b/i,
  /\benhanc(?:e|es|ed|ing|ement|ements)\b/i,
  // The past participle of draw passes only in its rendering sense.
  /\bdrawn\b(?! (?:to scale|on|in|as|by the|at))/i,
];

// Matches n't, 're, 've, 'll, 'm, and 'd after a letter. Possessive 's is
// allowed. Escaped quotes inside code strings never form these shapes.
const CONTRACTION = /\b[A-Za-z]+(?:n't|'re|'ve|'ll|'m|'d)\b/;
const DASHES = /[\u2013\u2014]/;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (CHECKED.has(extname(name)) && !EXEMPT.some((pattern) => pattern.test(path))) files.push(path);
  }
  return files;
}

function commentDensity(text, ext) {
  // Rust unit tests live at the end of the file they test. They are tests,
  // not logic, so counting stops where they begin.
  const body = ext === ".rs" ? text.split("#[cfg(test)]")[0] : text;
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  // Rust files can embed R source, whose comments start with a bare #.
  const comment = ext === ".py" ? /^#/ : ext === ".rs" ? /^(\/\/|\/\*|\*|# |#$)/ : /^(\/\/|\/\*|\*|#!)/;
  let docstring = false;
  let count = 0;
  for (const line of lines) {
    if (ext === ".py" && line.startsWith('"""')) {
      count += 1;
      if (!(line.length > 3 && line.endsWith('"""'))) docstring = !docstring;
      continue;
    }
    if (docstring || comment.test(line)) count += 1;
  }
  return { ratio: count / Math.max(lines.length, 1), lines: lines.length };
}

const problems = [];
for (const path of walk(root)) {
  const rel = relative(root, path);
  const text = readFileSync(path, "utf8");
  const ext = extname(path);
  text.split("\n").forEach((line, index) => {
    const where = `${rel}:${index + 1}`;
    if (DASHES.test(line)) problems.push(`${where} em or en dash`);
    const contraction = line.match(CONTRACTION);
    if (contraction) problems.push(`${where} contraction "${contraction[0]}"`);
    // A line quoting someone else's words, such as one of ggplot2's option
    // names or the title of a cited paper, carries a marker comment saying
    // why. Those words cannot be changed, so the word and spelling rules
    // skip that line. Dashes and contractions are still checked.
    if (rel.startsWith("scripts/standards/spelling") || line.includes("standards: ")) return;
    for (const pattern of BANNED) {
      const hit = line.match(pattern);
      if (hit) problems.push(`${where} banned word "${hit[0]}"`);
    }
    for (const word of line.match(/[A-Za-z]+/g) ?? []) {
      const american = BRITISH.get(word.toLowerCase());
      if (american) problems.push(`${where} British spelling "${word}", use "${american}"`);
    }
  });
  const isTest = /(^|\/)tests?\//.test(rel) || /\.test\.ts$/.test(rel);
  if (LOGIC.has(ext) && !isTest && !rel.startsWith("scripts/standards/spelling")) {
    const { ratio, lines } = commentDensity(text, ext);
    if (lines >= DENSITY_MIN_LINES && ratio < DENSITY_FLOOR) {
      problems.push(`${rel} comment density ${(ratio * 100).toFixed(1)} percent, floor is ${DENSITY_FLOOR * 100}`);
    }
  }
}

// The gate can only be trusted if it catches what it claims to. Each sample
// below must trip its rule. The samples are assembled from pieces so this
// file does not fail its own checks.
const selfTest = [
  ["We don" + "'t run that.", CONTRACTION],
  ["Results " + String.fromCharCode(0x2014) + " fast", DASHES],
  ["This will ens" + "ure it", BANNED[2]],
];
for (const [sample, pattern] of selfTest) {
  if (!pattern.test(sample)) problems.push(`gate self test failed on "${sample}"`);
}
if (!BRITISH.has("col" + "our")) problems.push("gate self test failed: spelling list is empty");

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} standards problem${problems.length === 1 ? "" : "s"} found.`);
  process.exit(1);
}
if (!process.argv.includes("--quiet")) console.log("Standards gate passed.");
