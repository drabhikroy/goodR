import { describe, expect, it } from "vitest";
import { sliderLabels } from "../../src/lib/sliderMarks";

const MINUTE = 60_000;
// A label of minutes since the first time, so tests need no clock.
const start = Date.UTC(2026, 10, 24, 13, 0);
const minutes = (time: number) => `${Math.floor((time - start) / MINUTE)}m`;
const at = (...offsets: number[]) => offsets.map((offset) => start + offset * MINUTE);

describe("the times under History's slider", () => {
  it("writes each minute once, even when several saves share it", () => {
    const times = at(0, 2, 2.2, 2.5, 3, 3.4);
    const labels = sliderLabels(times, minutes, 4, 800, 72);
    expect(labels.map((label) => label.text)).toEqual(["0m", "2m", "3m"]);
    expect(labels.find((label) => label.text === "3m")?.chosen).toBe(true);
  });

  it("keeps saves a day apart separate, even at the same time of day", () => {
    const labels = sliderLabels(at(0, 24 * 60), () => "9:05 AM", 0, 800, 72);
    expect(labels).toHaveLength(2);
  });

  it("puts a shared label under the first save it stands for", () => {
    const labels = sliderLabels(at(0, 5, 5.5), minutes, 0, 800, 72);
    expect(labels[1].at).toBeCloseTo(0.5);
  });

  it("marks a shared label as chosen for any of its saves", () => {
    const labels = sliderLabels(at(0, 5, 5.5), minutes, 2, 800, 72);
    expect(labels[1]).toMatchObject({ text: "5m", chosen: true });
  });

  it("skips labels that would overlap and keeps the one being compared", () => {
    const times = at(...Array.from({ length: 30 }, (_, minute) => minute));
    const labels = sliderLabels(times, minutes, 15, 300, 72);
    expect(labels.some((label) => label.text === "15m" && label.chosen)).toBe(true);
    for (let i = 1; i < labels.length; i += 1) expect((labels[i].at - labels[i - 1].at) * 300).toBeGreaterThanOrEqual(72);
  });

  it("keeps the oldest and newest when there is room", () => {
    const labels = sliderLabels(at(0, 60, 120, 180), minutes, 2, 800, 72);
    expect(labels[0].text).toBe("0m");
    expect(labels[labels.length - 1].text).toBe("180m");
  });
});
