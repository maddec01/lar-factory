// An optional record of the board server's memory, for attributing its RSS. BOARD_MEMORY_SAMPLES names the file;
// BOARD_MEMORY_FORCE_GC also forces a GC, with a sample on each side of it. Unset, it does nothing. `memory-run.ts` reads the file.

import { appendFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { log } from '../log.ts';

const SAMPLE_MS = 30_000;
const GC_MS = 300_000;

/** One line of the file. The memory figures are `process.memoryUsage()`'s bytes; `maxRSS` is `process.resourceUsage()`'s KiB. */
export interface MemorySample extends NodeJS.MemoryUsage {
    time: string;
    pid: number;
    kind: 'start' | 'interval' | 'before-gc' | 'after-gc';
    maxRSS: number;
}

/** The GC function. The server's arguments are fixed and Electron disables NODE_OPTIONS, so the flag is set in the process. */
function exposedGc(): () => void {
    setFlagsFromString('--expose-gc');
    return runInNewContext('gc') as () => void;
}

/** Starts the samples `env` asks for, and gives how to stop them. */
export function startMemorySampler(env: Record<string, string | undefined> = process.env): () => void {
    const file = env.BOARD_MEMORY_SAMPLES;
    if (!file) {
        if (env.BOARD_MEMORY_FORCE_GC) log('BOARD_MEMORY_FORCE_GC needs BOARD_MEMORY_SAMPLES; forcing no GC');
        return () => {};
    }
    if (!isAbsolute(file)) {
        log(`BOARD_MEMORY_SAMPLES=${file} is not an absolute path; taking no samples`);
        return () => {};
    }
    const sample = (kind: MemorySample['kind']) => {
        const line: MemorySample = {
            time: new Date().toISOString(),
            pid: process.pid,
            kind,
            ...process.memoryUsage(),
            maxRSS: process.resourceUsage().maxRSS,
        };
        try {
            appendFileSync(file, `${JSON.stringify(line)}\n`);
        } catch (error) {
            log(`memory sample failed: ${String(error)}`);
        }
    };
    sample('start');
    const timers = [setInterval(() => sample('interval'), SAMPLE_MS)];
    if (env.BOARD_MEMORY_FORCE_GC) {
        const gc = exposedGc();
        timers.push(
            setInterval(() => {
                sample('before-gc');
                gc();
                sample('after-gc');
            }, GC_MS),
        );
    }
    for (const timer of timers) timer.unref();
    return () => timers.forEach(clearInterval);
}
