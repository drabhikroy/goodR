#!/usr/bin/env node
// Downloads the pinned ark kernel for this computer, checks it against the
// recorded checksum, and places it where Tauri expects a bundled program.
//
// ark is pinned to one release because the app depends on details of its
// behavior, such as how it tags plot output. A newer release is adopted by
// testing it and then updating the version and checksums here together.
//
// Usage: node scripts/fetch-ark.mjs [target-triple]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ARK_VERSION = "0.1.252";

// Checksums recorded on Oct 10 2026 from the posit-dev/ark release assets.
const ASSETS = {
  "darwin-universal": "5655a80c495ee90965bc73fec58f15e4187d15bc9818c3355fa8096813ac6724",
  "linux-x64": "7dda5d05b6c4d67e7ae74e70b6bec5fd3bc526b19e222fa78306e14972cf4495",
  "linux-arm64": "aed35067f053c495d1e379649620df56142870f011695e1d88580ce32bcedefe",
  "windows-x64": "a6c2c6ae931d0dd5e1f771243bf3df4f86968462bbd8e08ceeba7f2e53567e58",
};

// Each Rust target triple maps to the ark asset that runs on it. The Mac
// build is universal, so one download serves both Mac triples.
const TRIPLES = {
  "aarch64-apple-darwin": "darwin-universal",
  "x86_64-apple-darwin": "darwin-universal",
  "universal-apple-darwin": "darwin-universal",
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "x86_64-pc-windows-msvc": "windows-x64",
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binaries = join(root, "src-tauri", "binaries");
const notices = join(root, "src-tauri", "resources", "ark");

function hostTriple() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return output.match(/^host: (.+)$/m)[1].trim();
}

async function download(asset) {
  const name = `ark-${ARK_VERSION}-${asset}.zip`;
  const url = `https://github.com/posit-dev/ark/releases/download/${ARK_VERSION}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with status ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== ASSETS[asset]) {
    throw new Error(`Checksum mismatch for ${name}\n  expected ${ASSETS[asset]}\n  received ${actual}`);
  }
  return bytes;
}

// Is ark in place, at the pinned version, for this triple?
function placed(triple) {
  const exe = triple.includes("windows") ? ".exe" : "";
  const stamp = join(binaries, `.ark-${triple}.version`);
  return existsSync(join(binaries, `ark-${triple}${exe}`)) && existsSync(stamp) && readFileSync(stamp, "utf8") === ARK_VERSION;
}

async function main() {
  const triple = process.argv[2] ?? hostTriple();
  const asset = TRIPLES[triple];
  if (!asset) throw new Error(`No ark build is pinned for ${triple}`);
  // A universal Mac build compiles each chip on its own before joining
  // them, and Tauri looks for ark under each chip's name as well.
  const triples = triple === "universal-apple-darwin" ? [triple, "aarch64-apple-darwin", "x86_64-apple-darwin"] : [triple];
  // The notices are checked too: they sit in a folder of their own, which a
  // clean copy of the project can leave out while keeping the binaries.
  const noticesPlaced = existsSync(join(notices, "LICENSE")) && existsSync(join(notices, "NOTICE"));
  const missing = triples.filter((each) => !noticesPlaced || !placed(each));
  if (!missing.length) {
    console.log(`ark ${ARK_VERSION} is already in place for ${triple}`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "goodfor-ark-"));
  try {
    const zip = join(work, "ark.zip");
    writeFileSync(zip, await download(asset));
    const exe = triple.includes("windows") ? ".exe" : "";
    if (exe) execFileSync("tar", ["-xf", zip, "-C", work]);
    else execFileSync("unzip", ["-q", "-o", zip, "-d", work]);
    mkdirSync(binaries, { recursive: true });
    mkdirSync(notices, { recursive: true });
    for (const each of missing) {
      const destination = join(binaries, `ark-${each}${exe}`);
      copyFileSync(join(work, `ark${exe}`), destination);
      if (!exe) chmodSync(destination, 0o755);
      writeFileSync(join(binaries, `.ark-${each}.version`), ARK_VERSION);
      console.log(`Placed ark ${ARK_VERSION} at ${destination}`);
    }
    // ark's license requires its notice to travel with the binary.
    copyFileSync(join(work, "LICENSE"), join(notices, "LICENSE"));
    copyFileSync(join(work, "NOTICE"), join(notices, "NOTICE"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
