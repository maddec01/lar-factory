import { WorkRecordError } from '@lar-factory/work-records';

import type { BoardState } from './board-state.ts';

/** Independent local tasks keep their warnings until that task succeeds. A newer database requires a restart. */
export function createLocalWork(
    board: Pick<BoardState, 'update' | 'push'>,
    log: (message: string) => void,
    onRestart: (problem: string) => void = () => {},
) {
    let blocked = false;
    const failures = new Map<string, { code: string; detail: string }>();
    const publish = () => {
        const problem = blocked
            ? 'Restart Lar Factory to continue.'
            : failures.size
              ? [...failures].map(([operation, { detail }]) => `${operation}: ${detail}`).join(' ') +
                ' The board will retry automatically. If this persists, use Diagnostics to resolve the named problem.'
              : undefined;

        board.update({ localProblem: problem, ...(blocked && { error: 'Restart Lar Factory to continue.' }) });
        board.push();
    };
    const failed = (operation: string, error: unknown) => {
        if (blocked) return;

        const code = error instanceof WorkRecordError ? error.code : 'local-refresh-failed';
        const detail =
            error instanceof WorkRecordError && code !== 'schema-too-new'
                ? error.message
                : 'Local work could not refresh; see Diagnostics.';
        const previous = failures.get(operation);

        // Every failure has a new identity, so an older overlapping success cannot clear it.
        failures.set(operation, { code, detail });

        if (code === 'schema-too-new') {
            blocked = true;
            onRestart('Restart Lar Factory to continue.');
        }

        if (previous?.code === code && previous.detail === detail) return;

        log(`local work paused: ${code} (${operation})${blocked ? '' : `: ${detail}`}`);
        publish();
    };
    const succeeded = (operation: string) => {
        if (blocked || !failures.delete(operation)) return;

        log(`local work recovered: ${operation}`);
        publish();
    };
    /** Returning false means no work was done, so it cannot prove recovery. */
    const run = (operation: string, work: () => unknown) => {
        if (blocked) return;

        const before = failures.get(operation);

        try {
            void Promise.resolve(work()).then(
                (result) => {
                    if (result !== false && failures.get(operation) === before) succeeded(operation);
                },
                (error: unknown) => failed(operation, error),
            );
        } catch (error) {
            failed(operation, error);
        }
    };

    return { blocked: () => blocked, failed, succeeded, run };
}
