// The board server's API: the board data kept live, as the server pushes it over /api/events and, while that
// stream is down, the page fetches /api/board every 15 s; and the page's writes, each answered with the board
// they left.

import { writeHeaders } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';

import { useBoardStore } from './board.hooks';

const POLL_MS = 15_000;

export function startLiveData(): void {
    const board = useBoardStore.getState();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    /** Whether the server's event stream is open; the page then stops polling. */
    let streaming = false;

    const receive = (text: string) => {
        const data = JSON.parse(text) as BoardData;

        board.receive(data);
    };

    function schedule(): void {
        clearTimeout(timer);

        // A silent stream sends no new data; the clock still moves on, so stale data shows as stale.
        if (streaming)
            timer = setTimeout(() => {
                board.tick();
                schedule();
            }, POLL_MS);
        else timer = setTimeout(() => void poll(), POLL_MS);
    }

    async function poll(): Promise<void> {
        const current = ++sequence;
        const writes = useBoardStore.getState().writes;
        // A write this page made meanwhile brought newer data than this poll's.
        const fresh = () => current === sequence && writes === useBoardStore.getState().writes;

        try {
            const res = await fetch('/api/board', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const text = await res.text();

            if (fresh()) receive(text);
        } catch (err) {
            if (fresh()) board.fail(err instanceof Error ? err.message : String(err));
        } finally {
            if (current === sequence) schedule();
        }
    }

    /** The browser reconnects a dropped stream by itself, but not a refused one. */
    function openStream(): void {
        const source = new EventSource('/api/events');

        source.onopen = () => {
            streaming = true;
            schedule();
        };
        source.onmessage = (event: MessageEvent<string>) => {
            // A push is the newest data: drop any poll still in flight.
            ++sequence;
            receive(event.data);
            schedule();
        };
        source.onerror = () => {
            // Fires on each failed reconnect too; only the first may restart the poll clock.
            if (streaming) {
                streaming = false;
                schedule();
            }

            if (source.readyState === EventSource.CLOSED) setTimeout(openStream, POLL_MS);
        };
    }

    schedule();
    openStream();
}

export interface ActionResult {
    /** A deliberate sample-server refusal, distinct from a failed operation. */
    code?: 'sample-mode';
    error: string | null;
    board?: BoardData;
    /** Queueing an issue from the list creates its local work ID. */
    itemId?: string;
}

/** Posts an item action and returns the server's answer, or a message when the server can't be reached. */
/** What a write on a sample board answers: the sample is a fixed file, so nothing it shows can change. */
export const SAMPLE_READ_ONLY = 'Sample boards are read-only.';

/** The refusals the server words for its own checks, in words for the person who pressed. */
const REFUSALS: Record<string, string> = {
    'Submit from this board page.':
        'The board only takes changes made on its own page. Reload the board and try again.',
    'Submit from the board app.': 'Only the board app can make this change. Make it there.',
};

/**
 * What a write's refusal says to a reader. The server's own sentence for a person stays as it is; a refusal from one of
 * its checks, or a bare HTTP failure, says on a sample board that sample boards are read-only, and elsewhere what to do.
 */
function refusal(error: string | null, ok: boolean): string | null {
    if (!error && ok) return null;

    if (error && !REFUSALS[error]) return error;

    if (useBoardStore.getState().data.capture?.enabled === false) return SAMPLE_READ_ONLY;

    return (error && REFUSALS[error]) ?? 'The board couldn’t make this change. Try again.';
}

export async function postAction<T extends object = object>(
    path: string,
    body: object,
    progress?: (value: Partial<T>) => void,
): Promise<ActionResult & Partial<T>> {
    useBoardStore.getState().beginWrite();

    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { ...writeHeaders(), ...(progress && { Accept: 'application/x-ndjson' }) },
            body: JSON.stringify(body),
        });

        if (response.headers.get('content-type')?.startsWith('application/x-ndjson') && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let pending = '';

            try {
                while (true) {
                    const chunk = await reader.read();

                    pending += decoder.decode(chunk.value, { stream: !chunk.done });

                    let newline;

                    while ((newline = pending.indexOf('\n')) >= 0) {
                        const event = JSON.parse(pending.slice(0, newline)) as {
                            progress?: Partial<T>;
                            result?: ActionResult & Partial<T>;
                        };

                        pending = pending.slice(newline + 1);

                        if (event.progress) progress?.(event.progress);

                        if (event.result) return event.result;
                    }

                    if (chunk.done) throw new Error('Incomplete progress response');
                }
            } finally {
                reader.releaseLock();
            }
        }

        const result = (await response.json()) as Partial<ActionResult & T>;

        return { ...result, error: refusal(result.error ?? null, response.ok) };
    } catch {
        return { error: 'Can’t reach the board server. Try again.' } as ActionResult & Partial<T>;
    }
}

/** Shows the board the server sent back with the action. Call inside the flushSync that shows the result. */
export function receive(result: ActionResult): void {
    if (!result.board) return;

    const board = useBoardStore.getState();

    board.beginWrite();
    board.receive(result.board, 'action');
}
