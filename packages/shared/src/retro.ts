/** The post-merge retro and its board-only follow-up decision. */
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
    delivery: { threadId: string; commandId: string; messageId: string; sent: boolean; error: string | null };
}

export const retroWaits = (retro: Retro | undefined | null): boolean =>
    !!retro &&
    ((!!retro.suggestions?.length && !retro.choice) ||
        !!retro.delivery.error ||
        !!retro.choice?.selected.some((index) => !retro.captures[index]?.complete));
