// Test-only clock adapter for subprocess HTTP tests. Production timing is unchanged.
import { appendFileSync } from 'node:fs';
import { setInterval as realSetInterval } from 'node:timers';

// Every source reads on each refresh tick, active or not.
process.env.BOARD_READ_MS ||= process.env.FAST_REFRESH_MS || '100';

/** The refresh tick's own interval in server.ts, which FAST_REFRESH_TICKS marks. */
const REFRESH_TICK_MS = 1_000;
// With FAST_REFRESH_TICKS, each refresh tick adds a tick entry to the fake gh's calls before it runs, so a test can
// order ticks against reads.
const ticks = process.env.FAST_REFRESH_TICKS === '1' ? `${process.env.FAKE_GH_STATE}.calls` : null;

globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  const run = ticks && delay === REFRESH_TICK_MS ? (...given: unknown[]) => { appendFileSync(ticks, '["tick"]\n'); callback(...given); } : callback;
  return realSetInterval(run, Math.min(delay ?? 0, Number(process.env.FAST_REFRESH_MS) || 100), ...args);
}) as typeof globalThis.setInterval;
