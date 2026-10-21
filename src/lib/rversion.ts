// Which R versions the app can run. ark, the kernel underneath, supports
// R 4.2 and later, so an older R is named and refused up front instead of
// failing partway through startup with a message from deep inside ark.

/** The oldest R that ark, and so this app, supports. */
export const OLDEST_R = "4.2";

/** Compares version numbers part by part, so 4.10 counts as newer than 4.9. */
export function isSupportedR(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [needMajor, needMinor] = OLDEST_R.split(".").map(Number);
  return major > needMajor || (major === needMajor && minor >= needMinor);
}
