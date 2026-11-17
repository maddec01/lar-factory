import type { Status } from './item-domain.ts';

/** The build's retro, proposed at handback, and its board-only follow-up decision, settled before merge. */
export interface RetroSuggestion {
    title: string;
    description: string;
    repository: string;
    kind: 'bug' | 'feature' | 'improvement';
}
export interface Retro {
    pr: string;
    suggestions: RetroSuggestion[] | null;
    choice: { selected: number[]; by: string; at: string } | null;
    captures: {
        requestId: string;
        ticketRequestId: string;
        workId: string | null;
        error: string | null;
        complete: boolean;
    }[];
    /** The post-merge thread message of builds handed back before Retro moved before merge; new records omit it. */
    delivery?: { threadId: string; commandId: string; messageId: string; sent: boolean; error: string | null };
}

/** A Done build merged its PR, so its unchosen or uncaptured follow-ups are dropped rather than awaited. */
export const retroWaits = (retro: Retro | undefined | null, status: Status): boolean =>
    !!retro &&
    status !== 'Done' &&
    ((!!retro.suggestions?.length && !retro.choice) ||
        !!retro.choice?.selected.some((index) => !retro.captures[index]?.complete));
