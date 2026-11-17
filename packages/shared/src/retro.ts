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

/** An unanswered optional pick survives merge; choosing none dismisses it. Failed captures no longer wait. */
export const retroWaits = (retro: Retro | undefined | null): boolean =>
    !!retro && !!retro.suggestions?.length && !retro.choice;
