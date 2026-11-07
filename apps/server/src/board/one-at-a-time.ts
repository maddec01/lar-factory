// Runs work that takes turns of the event loop one at a time, so two runs never share a turn.

/** The returned function runs `work` once the work it was given before has ended, however that ended. */
export function oneAtATime(): <T>(work: () => Promise<T>) => Promise<T> {
    let running: Promise<unknown> = Promise.resolve();

    return (work) => {
        const run = running.then(work);

        running = run.catch(() => {});

        return run;
    };
}
