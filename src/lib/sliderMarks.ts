// The time labels under History's slider.
//
// Several saves in the same minute would print the same time side by side,
// and a busy afternoon would print more times than the slider has room for.
// So versions that share a minute get one label, under the first of them.
// Labels go down in order of importance (the version being compared, then
// the oldest and newest, then the rest from oldest to newest), and one that
// would overlap a label already down is skipped. Every version still gets
// its own dot on the slider, so nothing kept goes unseen.

export type SliderLabel = {
  /** Where the label sits along the slider, from 0 (oldest) to 1 (newest). */
  at: number;
  text: string;
  chosen: boolean;
};

type Group = { from: number; to: number; text: string; minute: number };

/**
 * @param times when each version was kept, in milliseconds, oldest first
 * @param textOf the label for a time
 * @param chosen the slider position of the version being compared
 * @param width the slider's width in pixels
 * @param room the space one label needs, in pixels
 */
export function sliderLabels(times: number[], textOf: (time: number) => string, chosen: number, width: number, room: number): SliderLabel[] {
  const count = times.length;
  if (count === 0) return [];
  const groups: Group[] = [];
  times.forEach((time, position) => {
    const minute = Math.floor(time / 60_000);
    const last = groups[groups.length - 1];
    if (last && last.minute === minute) last.to = position;
    else groups.push({ from: position, to: position, text: textOf(time), minute });
  });
  const at = (group: Group) => (count === 1 ? 0.5 : group.from / (count - 1));
  const holds = (group: Group) => chosen >= group.from && chosen <= group.to;
  const order = [...groups].sort((a, b) => rank(a) - rank(b) || a.from - b.from);
  function rank(group: Group) {
    if (holds(group)) return 0;
    if (group === groups[0] || group === groups[groups.length - 1]) return 1;
    return 2;
  }
  const placed: SliderLabel[] = [];
  for (const group of order) {
    const spot = at(group);
    const crowded = placed.some((label) => Math.abs(label.at - spot) * width < room);
    if (!crowded) placed.push({ at: spot, text: group.text, chosen: holds(group) });
  }
  return placed.sort((a, b) => a.at - b.at);
}
