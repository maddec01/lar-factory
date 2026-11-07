// Times one stats read, step by step, and gives it its turns of the event loop: every await of the read goes through a
// trace, so the time between two awaits is one synchronous block, which the board's log names by its step.

import { performance } from 'node:perf_hooks';

import { loopTrace, nextTurn } from '../startup/loop-trace.ts';

type StatsStep = 'inputs' | 'discovery' | 'warm' | 'dedup' | 'aggregation' | 'publish';

const STEPS: StatsStep[] = ['inputs', 'discovery', 'warm', 'dedup', 'aggregation', 'publish'];

interface StepTrace {
    elapsedMs: number;
    cpuMs: number;
    longestBlockMs: number;
    pauses: number;
}

export interface ReadTrace {
    /** Starts a step, which runs until the next one or `finish`. */
    step(name: StatsStep): void;
    /** Waits for `work`, which ends the running block. */
    wait<T>(work: Promise<T>): Promise<T>;
    /** Lets the event loop turn, between two chunks of a step's work. */
    pause: () => Promise<void>;
    /** Ends the read's last step. */
    finish: () => void;
    readonly steps: Readonly<Record<StatsStep, StepTrace>>;
    /** The whole read, in milliseconds. */
    elapsedMs(): number;
    cpuMs(): number;
    /** The longest block of the read and its step. */
    longestBlock(): { ms: number; step: StatsStep };
}

const cpuMs = (used: NodeJS.CpuUsage) => (used.user + used.system) / 1000;

export function createReadTrace(turn: () => Promise<void> = nextTurn): ReadTrace {
    const steps = Object.fromEntries(
        STEPS.map((name) => [name, { elapsedMs: 0, cpuMs: 0, longestBlockMs: 0, pauses: 0 }]),
    ) as Record<StatsStep, StepTrace>;
    const startedAt = performance.now();
    const startCpu = process.cpuUsage();
    let finishedAt: number | undefined;
    let current: StatsStep | undefined;
    let stepAt = startedAt;
    let stepCpu = startCpu;
    let blockAt = startedAt;
    let blockCpu = startCpu;
    let spannedAt = loopTrace.spanned();

    const endBlock = () => {
        if (!current) return;

        const blockMs = performance.now() - blockAt;

        steps[current].longestBlockMs = Math.max(steps[current].longestBlockMs, blockMs);
        loopTrace.block(`stats ${current}`, blockMs, spannedAt, cpuMs(process.cpuUsage(blockCpu)));
        spannedAt = loopTrace.spanned();
    };
    const endStep = () => {
        if (!current) return;

        endBlock();

        const now = performance.now();

        steps[current].elapsedMs += now - stepAt;
        steps[current].cpuMs += cpuMs(process.cpuUsage(stepCpu));
        stepAt = now;
        stepCpu = process.cpuUsage();
    };
    const wait = async <T>(work: Promise<T>): Promise<T> => {
        endBlock();

        try {
            return await work;
        } finally {
            blockAt = performance.now();
            blockCpu = process.cpuUsage();
            spannedAt = loopTrace.spanned();
        }
    };

    return {
        step(name) {
            endStep();
            current = name;
            stepAt = performance.now();
            stepCpu = process.cpuUsage();
            blockAt = stepAt;
            blockCpu = stepCpu;
            spannedAt = loopTrace.spanned();
        },
        wait,
        pause() {
            if (current) steps[current].pauses++;

            return wait(turn());
        },
        finish() {
            endStep();
            current = undefined;
            finishedAt = performance.now();
        },
        steps,
        elapsedMs: () => (finishedAt ?? performance.now()) - startedAt,
        cpuMs: () => cpuMs(process.cpuUsage(startCpu)),
        longestBlock() {
            const step = STEPS.reduce((longest, name) =>
                steps[name].longestBlockMs > steps[longest].longestBlockMs ? name : longest,
            );

            return { ms: steps[step].longestBlockMs, step };
        },
    };
}
