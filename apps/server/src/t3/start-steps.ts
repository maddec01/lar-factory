import { AsyncLocalStorage } from 'node:async_hooks';

/** The steps one Start took so far, each with its time in milliseconds, and when the last one ended. */
interface StartSteps {
    steps: string[];
    at: number;
}

const startSteps = new AsyncLocalStorage<StartSteps>();

/** Runs `work` as one Start, whose steps `startStep` times; `done` gets the timed steps once it settles. */
export function timeStart<T>(work: () => Promise<T>, done: (steps: string) => void): Promise<T> {
    const timing: StartSteps = { steps: [], at: performance.now() };

    return startSteps.run(timing, work).finally(() => done(timing.steps.join(', ')));
}

/** Ends the running Start's current step as `name`; outside a Start it does nothing. */
export function startStep(name: string): void {
    const timing = startSteps.getStore();

    if (!timing) return;

    const now = performance.now();

    timing.steps.push(`${name} ${Math.round(now - timing.at)}ms`);
    timing.at = now;
}
