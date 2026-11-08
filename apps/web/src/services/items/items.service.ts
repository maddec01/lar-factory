// The board server's reads of one item beyond the board data: its details, older comments, tracker labels, checks and
// a pull request's Azure readiness, and the write that adds an item from Add item. Each answers with what the page
// shows, or the words to show when the board couldn't answer.

import { writeHeaders } from '@lar-factory/shared';
import type {
    BoardData,
    CreationResult,
    ItemChecks,
    ItemCommentsPage,
    ItemDetails,
    TrackerLabel,
} from '@lar-factory/shared';

/** An item's details, or why the board didn't return them. */
export async function readItemDetails(
    itemId: string,
    signal: AbortSignal,
): Promise<{ details: ItemDetails } | { error: string }> {
    try {
        const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(itemId)}`, {
            cache: 'no-store',
            signal,
        });
        const body = (await response.json()) as { details?: ItemDetails; error?: string };

        if (response.ok && body.details) return { details: body.details };

        return { error: body.error ?? 'The board didn’t return the details.' };
    } catch {
        return { error: 'Couldn’t reach the board to read the details.' };
    }
}

/** The page of comments older than the `before` cursor, or why it couldn't be read. */
export async function readOlderComments(
    itemId: string,
    before: string,
    signal: AbortSignal,
): Promise<ItemCommentsPage | string> {
    try {
        const response = await fetch(
            `/api/item-comments?itemId=${encodeURIComponent(itemId)}&before=${encodeURIComponent(before)}`,
            { cache: 'no-store', signal },
        );
        const body = (await response.json()) as { page?: ItemCommentsPage; error?: string };

        return response.ok && body.page ? body.page : (body.error ?? 'The board didn’t return them.');
    } catch {
        return 'Couldn’t reach the board to read them.';
    }
}

const LABELS_NOT_READ = 'Couldn’t reach the board to read the labels.';

/** The labels the item's tracker offers, or why they couldn't be read. */
export async function readItemLabels(itemId: string): Promise<TrackerLabel[] | string> {
    try {
        const response = await fetch(`/api/item-labels?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
        const body = (await response.json()) as { labels?: TrackerLabel[]; error?: string };

        return body.labels ?? body.error ?? LABELS_NOT_READ;
    } catch {
        return LABELS_NOT_READ;
    }
}

/** A build's recorded checks; throws with the words to show when the board doesn't return them. */
export async function readItemChecks(itemId: string): Promise<ItemChecks> {
    const response = await fetch(`/api/item-checks?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
    const body = (await response.json()) as { checks?: ItemChecks; error?: string };

    if (!response.ok || !body.checks) throw new Error(body.error ?? 'The board didn’t return checks.');

    return body.checks;
}

/** What Azure says stands between a pull request and its merge. */
export type PrEvidence =
    | { available: true; sourceRevision: string; observedAt: string; blockers: string[] }
    | { available: false; reason: string };

const NO_EVIDENCE = 'Azure evidence is unavailable. Refresh to try again.';

/** A pull request's readiness evidence, read afresh; an unavailable answer when the board can't give it. Rejects only
 *  when `signal` aborts the read. */
export async function readPrReadiness(itemId: string, number: number, signal: AbortSignal): Promise<PrEvidence> {
    try {
        const response = await fetch('/api/pr-readiness', {
            method: 'POST',
            headers: writeHeaders(),
            body: JSON.stringify({ itemId, number }),
            signal,
        });

        if (!response.ok) throw new Error(NO_EVIDENCE);

        return ((await response.json()) as { evidence: PrEvidence }).evidence;
    } catch (err) {
        if (signal.aborted) throw err;

        return { available: false, reason: NO_EVIDENCE };
    }
}

/** The board's answer to an Add item submission. */
export type ItemSubmission = CreationResult & { uncertain?: boolean; board?: BoardData };

/**
 * Sends an Add item submission and returns the board's answer with its HTTP status. Rejects when the answer is lost on
 * the way, so the caller can resend the same attempt.
 */
export async function submitItem(attempt: object): Promise<{ status: number; result: ItemSubmission }> {
    const response = await fetch('/api/items', {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify(attempt),
    });

    return { status: response.status, result: (await response.json()) as ItemSubmission };
}
