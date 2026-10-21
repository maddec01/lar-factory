// Test-only clock adapter for subprocess HTTP tests. Production timing is unchanged.
import { setInterval as realSetInterval } from 'node:timers';

globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
  realSetInterval(callback, Math.min(delay ?? 0, 100), ...args)) as typeof globalThis.setInterval;
