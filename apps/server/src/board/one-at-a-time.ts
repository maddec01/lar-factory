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

/**
 * The returned function runs `work` unless a run is in progress. Then it starts nothing and returns false: it asks for
 * one more run once the running one ends, given every waiting ask's argument combined by `merge`. A failed run leaves
 * that ask for the next one.
 */
export function oneRunAndOneMore<A>(
    work: (arg: A) => Promise<unknown>,
    merge: (a: A, b: A) => A,
): (arg: A) => Promise<unknown> | false {
    let running = false;
    let waiting: { arg: A } | null = null;
    // A loop, not a call to itself, so sustained asks never grow a chain of promises.
    const run = async (arg: A): Promise<unknown> => {
        let next: { arg: A } | null = { arg };
        let result: unknown;

        while (next) {
            running = true;

            try {
                result = await work(next.arg);
            } finally {
                running = false;
            }

            next = waiting;
            waiting = null;
        }

        return result;
    };

    return (arg) => {
        if (running) {
            waiting = { arg: waiting ? merge(waiting.arg, arg) : arg };

            return false;
        }

        const next = waiting ? merge(waiting.arg, arg) : arg;

        waiting = null;

        return run(next);
    };
}
