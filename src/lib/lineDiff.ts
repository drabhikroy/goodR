// What changed between two versions of a file, line by line, in pieces a
// person can read: lines that stayed, lines added, lines taken out, and
// lines changed, which are a run of removed lines with added ones in their
// place. It is the longest common run of lines, as diff finds, kept simple
// because scripts are short; a very long pair is compared by its changed
// middle only, after the lines both share at the start and the end.

export type Piece =
  | { kind: "same"; lines: string[]; oldFrom: number; newFrom: number }
  | { kind: "added" | "removed" | "changed"; before: string[]; after: string[]; oldFrom: number; newFrom: number };

// Beyond this many line pairs the middle is treated as one change, which
// keeps the comparison quick on any file.
const LIMIT = 4_000_000;

/** The pieces that turn `before` into `after`, in order. */
export function lineDiff(beforeText: string, afterText: string): Piece[] {
  const a = beforeText.split("\n");
  const b = afterText.split("\n");
  // Lines shared at the start and the end need no comparing.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  // Pairs of matching line numbers, from the longest common run.
  const pairs: [number, number][] = [];
  if (midA.length * midB.length <= LIMIT) {
    const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i -= 1) for (let j = midB.length - 1; j >= 0; j -= 1) table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    for (let i = 0, j = 0; i < midA.length && j < midB.length; ) {
      if (midA[i] === midB[j]) pairs.push([i++, j++]);
      else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
      else j += 1;
    }
  }
  const pieces: Piece[] = [];
  const same = (from: number, to: number, newFrom: number) => {
    if (to <= from) return;
    const last = pieces[pieces.length - 1];
    if (last?.kind === "same") last.lines.push(...a.slice(from, to));
    else pieces.push({ kind: "same", lines: a.slice(from, to), oldFrom: from, newFrom });
  };
  const change = (oldFrom: number, oldTo: number, newFrom: number, newTo: number) => {
    const before = a.slice(oldFrom, oldTo);
    const after = b.slice(newFrom, newTo);
    if (!before.length && !after.length) return;
    pieces.push({ kind: before.length && after.length ? "changed" : before.length ? "removed" : "added", before, after, oldFrom, newFrom });
  };
  same(0, start, 0);
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [midA.length, midB.length] as [number, number]]) {
    change(start + i, start + pi, start + j, start + pj);
    if (pi < midA.length) same(start + pi, start + pi + 1, start + pj);
    i = pi + 1;
    j = pj + 1;
  }
  same(a.length - end, a.length, b.length - end);
  return pieces;
}

/** What changed, counted in plain words, such as "3 lines added, 1 taken
 * out, and 2 changed". */
export function changeSummary(pieces: Piece[]): string {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const piece of pieces) {
    if (piece.kind === "added") added += piece.after.length;
    else if (piece.kind === "removed") removed += piece.before.length;
    else if (piece.kind === "changed") changed += Math.max(piece.before.length, piece.after.length);
  }
  const parts = [
    added && `${added} ${added === 1 ? "line" : "lines"} added`,
    removed && `${removed} taken out`,
    changed && `${changed} changed`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "No changes";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
