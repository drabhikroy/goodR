#!/usr/bin/env node
// Audits every color pairing the interface uses, in every appearance and
// all five color vision palettes.
//
// Two kinds of check run here:
//   1. WCAG 2.2 contrast. Text needs 4.5 to 1 against every ground it
//      appears on. Control boundaries and focus outlines need 3 to 1.
//   2. Separation. The status colors (ok, warning, error) must stay
//      distinguishable for the people each palette is for. Each palette is
//      checked under its own color vision simulation (Machado, Oliveira,
//      and Fernandes 2009, full severity), measured as distance in Oklab,
//      which tracks perceived difference far better than CIE76 at the large
//      differences that matter here. Shape always carries the same meaning
//      as color, so this is a second line of defense, not the only one.
//
// Usage: node scripts/standards/contrast.mjs [--verbose]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const tokens = JSON.parse(readFileSync(join(root, "src/theme/tokens.json"), "utf8"));
const verbose = process.argv.includes("--verbose");

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const SEPARATION_MIN = 0.08;

function hexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => {
    const channel = ((value >> shift) & 255) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function luminance(linear) {
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(a, b) {
  const [la, lb] = [luminance(hexToLinear(a)), luminance(hexToLinear(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Machado, Oliveira, and Fernandes (2009) simulation matrices at severity
// 1.0, applied to linear RGB.
const SIMULATIONS = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

function simulate(linear, kind) {
  const matrix = SIMULATIONS[kind];
  if (!matrix) return linear;
  return matrix.map((row) => Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])));
}

// Linear sRGB to Oklab (Ottosson 2020).
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817104123 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function separation(a, b, kind) {
  const [x, y] = [oklab(simulate(hexToLinear(a), kind)), oklab(simulate(hexToLinear(b), kind))];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const failures = [];
let checks = 0;

function needContrast(label, fg, bg, minimum) {
  checks += 1;
  const ratio = contrast(fg, bg);
  if (verbose) console.log(`${ratio.toFixed(2).padStart(6)}  ${label}`);
  if (ratio < minimum) failures.push(`${label}: ${fg} on ${bg} is ${ratio.toFixed(2)} to 1, needs ${minimum}`);
}

// A palette can recolor the accent family too, the blue of buttons, links,
// focus rings, and selection, so the window as a whole follows it. Every
// check below runs on each mode as each palette leaves it.
for (const [modeName, base] of Object.entries(tokens.modes)) for (const [paletteName, palette] of Object.entries(tokens.palettes)) {
  const mode = { ...base, ...palette[modeName] };
  const label = `${modeName} ${paletteName}`;
  const grounds = ["window", "sunken", "surface", "raised", "hover", "activeLine", "codeBg", "consoleBg", "desk", "sidebar", "cellIn", "cellOut", "cellHead", "cellOutHead", "backdrop", "panel"];
  for (const ground of grounds) {
    needContrast(`${label} text on ${ground}`, mode.text, mode[ground], TEXT_MIN);
    needContrast(`${label} textMuted on ${ground}`, mode.textMuted, mode[ground], TEXT_MIN);
    needContrast(`${label} link on ${ground}`, mode.link, mode[ground], TEXT_MIN);
  }
  // A card's outline sets it apart from the page around it, so it needs
  // the 3 to 1 of a graphic against both the page and the desk.
  for (const ground of ["codeBg", "desk", "cellOut", "cellIn"]) {
    needContrast(`${label} cardEdge on ${ground}`, mode.cardEdge, mode[ground], NON_TEXT_MIN);
  }
  // The rule down the left of a result ties it to its code, so it needs the
  // 3 to 1 of a graphic against every surface it runs beside.
  for (const ground of ["codeBg", "cellOut", "cellIn"]) {
    needContrast(`${label} cellRule on ${ground}`, mode.cellRule, mode[ground], NON_TEXT_MIN);
  }
  for (const ground of ["surface", "raised", "codeBg", "activeLine", "sunken", "cellIn"]) {
    needContrast(`${label} textFaint on ${ground}`, mode.textFaint, mode[ground], TEXT_MIN);
  }
  needContrast(`${label} text on selection`, mode.text, mode.selection, TEXT_MIN);
  needContrast(`${label} text on accentSoft`, mode.text, mode.accentSoft, TEXT_MIN);
  needContrast(`${label} onAccent on accent`, mode.onAccent, mode.accent, TEXT_MIN);
  needContrast(`${label} onAccent on accentHover`, mode.onAccent, mode.accentHover, TEXT_MIN);
  needContrast(`${label} brand on window`, mode.brand, mode.window, TEXT_MIN);
  for (const ground of ["window", "surface", "raised", "sunken", "sidebar", "backdrop", "panel"]) {
    needContrast(`${label} borderStrong on ${ground}`, mode.borderStrong, mode[ground], NON_TEXT_MIN);
    needContrast(`${label} focus on ${ground}`, mode.focus, mode[ground], NON_TEXT_MIN);
  }
  needContrast(`${label} accent fill on window`, mode.accent, mode.window, NON_TEXT_MIN);
  // The signal color marks the lines R is running. It is a bar beside the
  // code, never text, so it needs the 3 to 1 of a graphic.
  for (const ground of ["codeBg", "activeLine", "window", "surface", "signalSoft"]) {
    needContrast(`${label} signal on ${ground}`, mode.signal, mode[ground], NON_TEXT_MIN);
  }
  needContrast(`${label} text on signalSoft`, mode.text, mode.signalSoft, TEXT_MIN);

  for (const status of ["ok", "warn", "danger"]) {
    for (const ground of ["surface", "raised", "window", "sunken", "sidebar", "cellOut", "cellOutHead"]) {
      needContrast(`${label} ${status} on ${ground}`, mode[status], mode[ground], TEXT_MIN);
    }
    needContrast(`${label} ${status} on its soft ground`, mode[status], mode[`${status}Soft`], TEXT_MIN);
    needContrast(`${label} text on ${status}Soft`, mode.text, mode[`${status}Soft`], TEXT_MIN);
  }
  for (const role of ["keyword", "string", "comment", "function", "number"]) {
    for (const ground of ["codeBg", "activeLine", "raised", "cellIn"]) {
      needContrast(`${label} syntax ${role} on ${ground}`, mode[role], mode[ground], TEXT_MIN);
    }
  }
  // Monochrome relies on shape and lightness alone by design, so it has
  // no hue separation to check.
  if (paletteName === "monochrome") continue;
  const vision = paletteName === "standard" ? "normal" : paletteName;
  const pairs = [["ok", "warn"], ["ok", "danger"], ["warn", "danger"]];
  for (const [a, b] of pairs) {
    checks += 1;
    const distance = separation(mode[a], mode[b], vision);
    if (verbose) console.log(`${distance.toFixed(3).padStart(6)}  ${label} ${a} and ${b} under ${vision} vision`);
    if (distance < SEPARATION_MIN) {
      failures.push(`${label}: ${a} and ${b} are only ${distance.toFixed(3)} apart in Oklab under ${vision} vision, need ${SEPARATION_MIN}`);
    }
  }
}

// The protanopia and deuteranopia palettes must be genuinely different,
// because protanopia also darkens reds. A copy would serve one group badly.
for (const modeName of Object.keys(tokens.modes)) {
  checks += 1;
  const a = tokens.palettes.protanopia[modeName].danger;
  const b = tokens.palettes.deuteranopia[modeName].danger;
  if (a === b) failures.push(`${modeName}: protanopia and deuteranopia share the same error color`);
  // Under protanopia, the protanopia error color must keep more lightness
  // than the deuteranopia one, which is the point of having two palettes.
  // On a light page, Light or Paper, both error colors are dark by need, so
  // the rule applies to the dark appearance.
  const kept = (hex) => oklab(simulate(hexToLinear(hex), "protanopia"))[0];
  if (modeName === "dark" && kept(a) < kept(b)) {
    failures.push(`${modeName}: the protanopia error color loses more lightness under protanopia than the deuteranopia one`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} of ${checks} color checks failed.`);
  process.exit(1);
}
console.log(`Color audit passed: ${checks} checks across ${Object.keys(tokens.modes).length} appearances and ${Object.keys(tokens.palettes).length} palettes.`);
