// Runs work a burst of triggers asks for: the first trigger runs it at once, and those within `gapMs` of a run earn one follow-up.

/** The returned function asks for the work. `work` handles its own failures, as a follow-up runs on a timer. */
export function coalesced(work: () => void, gapMs: number): () => void {
  let gap: NodeJS.Timeout | undefined;
  let again = false;
  const run = () => {
    work();
    gap = setTimeout(() => {
      gap = undefined;
      if (!again) return;
      again = false;
      run();
    }, gapMs);
    gap.unref();
  };
  return () => {
    if (gap) again = true;
    else run();
  };
}
