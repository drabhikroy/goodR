// History's two colors: one for an earlier version of a script and one for
// now. The palette gives each a default, apricot and orchid, chosen to stay
// apart for every kind of color vision the app has a palette for. Settings
// lets a person pick their own, typed as hex or as RGB, and this works out
// the soft ground behind each changed line so code still reads on it.

/** The roles whose colors sit on History's soft grounds. Every one must
 * keep the 4.5 to 1 of text there. */
export const READ_ON_SOFT = ["text", "textMuted", "keyword", "string", "comment", "function", "number"] as const;

/**
 * Reads a color as a person might type it: #RGB, #RRGGBB (with or without
 * the #), rgb(12, 34, 56), or just three numbers, 12, 34, 56. Returns it
 * as #RRGGBB in capitals, or null when it is not a color.
 */
export function parseColor(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return `#${digits.toUpperCase()}`;
  }
  const rgb = /^(?:rgba?\s*\(\s*)?(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)?$/i.exec(text);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.some((value) => value > 255)) return null;
    return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return null;
}

/** A color's red, green, and blue, 0 to 255. */
export function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A color written as rgb(r, g, b), for showing beside its hex. */
export function rgbText(hex: string) {
  return `rgb(${channels(hex).join(", ")})`;
}

function toLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number) {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round((clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255);
}

function hexOf(rgb: number[]) {
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** WCAG contrast between two colors, 1 to 21. */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = channels(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Oklab (Ottosson 2020), for tints that keep the ground's lightness.
function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, a, b]: [number, number, number]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return hexOf([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLinear));
}

/** A mix of two colors in linear light, `amount` of the second. */
function mix(a: string, b: string, amount: number) {
  const [x, y] = [channels(a).map(toLinear), channels(b).map(toLinear)];
  return hexOf(x.map((value, index) => fromLinear(value * (1 - amount) + y[index] * amount)));
}

/**
 * The soft ground behind a changed line in History, for a bar color on a
 * code background. On a dark page it takes the bar's hue at nearly the
 * page's own lightness; on a light page it is a light wash of the bar.
 * Either way it is made fainter, step by step, until every color that
 * sits on it still reads at 4.5 to 1.
 */
export function softGround(bar: string, codeBg: string, dark: boolean, readers: string[]): string {
  const reads = (ground: string) => readers.every((color) => contrast(color, ground) >= 4.5);
  if (dark) {
    const [L] = toOklab(codeBg);
    const [, a, b] = toOklab(bar);
    const chroma = Math.hypot(a, b);
    for (const strength of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const scale = chroma > 0.01 ? (0.03 * strength) / chroma : 0;
      const ground = fromOklab([L + 0.04 * strength, a * scale, b * scale]);
      if (reads(ground)) return ground;
    }
    return codeBg;
  }
  for (const amount of [0.24, 0.2, 0.16, 0.12, 0.08, 0.04, 0]) {
    const ground = mix(codeBg, bar, amount);
    if (reads(ground)) return ground;
  }
  return codeBg;
}

/** How a chosen bar color fares on the current code background: fine,
 * or a plain warning that it is hard to see there. */
export function barNote(bar: string, codeBg: string): string | null {
  const ratio = contrast(bar, codeBg);
  return ratio >= 3 ? null : `Hard to see on this theme (${ratio.toFixed(1)} to 1, 3 to 1 is the least for a mark like this).`;
}
