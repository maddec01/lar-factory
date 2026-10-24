// Time intervals in milliseconds, as [start, end), for summing agent and wall time.

export type Interval = [number, number];

/** The intervals merged into disjoint ones, earliest first, dropping empty ones. */
export function merged(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (!(end > start)) continue;
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** The parts of each interval that no interval in `cut` covers. */
export function minus(intervals: Interval[], cut: Interval[]): Interval[] {
  const holes = merged(cut);
  return intervals.flatMap(([start, end]) => {
    const parts: Interval[] = [];
    let from = start;
    for (const [holeStart, holeEnd] of holes) {
      if (holeEnd <= from || holeStart >= end) continue;
      if (holeStart > from) parts.push([from, holeStart]);
      from = Math.max(from, holeEnd);
    }
    if (end > from) parts.push([from, end]);
    return parts;
  });
}

export const length = (intervals: Interval[]): number => intervals.reduce((total, [start, end]) => total + end - start, 0);
