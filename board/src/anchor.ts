// Which item holds the reading position across a re-render. Shared with the
// browser, imports nothing; client.ts measures the elements.

/** One key per appearance, since an item can be drawn twice (a concept's sub-issue row and its own card). */
export function anchorKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return `${id}|${n}`;
  });
}

/**
 * The key to hold in place: the visible one at `index` if it survived, else the
 * nearest survivor in the old order, looking down before up. Null if none did.
 */
export function survivingAnchor(keys: readonly string[], index: number, present: ReadonlySet<string>): string | null {
  for (let d = 0; d < keys.length; d++) {
    for (const i of d ? [index + d, index - d] : [index]) {
      const key = keys[i];
      if (key !== undefined && present.has(key)) return key;
    }
  }
  return null;
}
