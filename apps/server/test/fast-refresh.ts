// Test-only clock adapter for subprocess HTTP tests. Production timing is unchanged.
import { setInterval as realSetInterval } from 'node:timers';

// Every source reads on each refresh tick, active or not.
process.env.BOARD_READ_MS ||= process.env.FAST_REFRESH_MS || '100';

globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
  realSetInterval(callback, Math.min(delay ?? 0, Number(process.env.FAST_REFRESH_MS) || 100), ...args)) as typeof globalThis.setInterval;
