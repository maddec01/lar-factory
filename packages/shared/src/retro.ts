import type { Status } from './item-domain.ts';

/** The build's Retro, proposed when its PR opens, and its board-only follow-up decision. */
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
        complete: boolean;
    }[];
}

/** Only an unmade pick waits: a failed capture is reported once, and a Done build drops its unchosen follow-ups. */
export const retroWaits = (retro: Retro | undefined | null, status: Status): boolean =>
    !!retro && status !== 'Done' && !!retro.suggestions?.length && !retro.choice;
