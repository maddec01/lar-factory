// The board server's ticket calls: searching a repository's open tickets, the options a new issue can take, the text a
// piece of local work would send as its issue, and creating that issue.

import { writeHeaders } from '@lar-factory/shared';
import type { BoardData, Item, TicketCreationOptions, TicketMatch } from '@lar-factory/shared';

/** The repository's open tickets matching `query`: the matches, or the error to show. */
export async function searchTickets(repo: string, query: string): Promise<TicketMatch[] | string> {
    try {
        const response = await fetch(`/api/tickets?${new URLSearchParams({ repo, q: query })}`);
        const result = (await response.json()) as { tickets?: TicketMatch[]; error?: string | null };

        return result.tickets ?? result.error ?? `Request failed (HTTP ${response.status}).`;
    } catch {
        return 'Can’t reach the board server. Try again.';
    }
}

/** The fields a new issue in `repo` can set; throws when the board can't say. */
export async function readTicketOptions(repo: string): Promise<TicketCreationOptions> {
    const response = await fetch(`/api/ticket-options?repo=${encodeURIComponent(repo)}`);
    const result = (await response.json()) as { options?: TicketCreationOptions; error?: string };

    if (!response.ok || !result.options) throw Error(result.error ?? 'Couldn’t read issue options.');

    return result.options;
}

/** The title and description a piece of local work would send as its issue, at the work's revision. */
export interface TicketPreview {
    title: string;
    description: string;
    revision: number;
}

/** The text local work would send as its issue; throws when the board can't give it. */
export async function readTicketPreview(itemId: string): Promise<TicketPreview> {
    const response = await fetch(`/api/ticket-preview?itemId=${encodeURIComponent(itemId)}`);
    const result = (await response.json()) as { preview?: TicketPreview; error?: string };

    if (!response.ok || !result.preview) throw Error(result.error ?? 'Couldn’t read the outgoing issue text.');

    return result.preview;
}

/** The board's answer to Create issue. */
export interface TicketCreation {
    item?: Item;
    board?: BoardData;
    error: string | null;
    uncertain?: boolean;
}

/**
 * Sends a Create issue submission and returns the board's answer with its HTTP status. Rejects when the answer is lost
 * on the way, so the caller can resend the same request.
 */
export async function submitTicket(submission: object): Promise<{ status: number; result: TicketCreation }> {
    const response = await fetch('/api/create-ticket', {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify(submission),
    });

    return { status: response.status, result: (await response.json()) as TicketCreation };
}
