// What the board search lists: groups of options in list order, each option doing its own thing when chosen, and the
// words that narrow them. A result contains every query word as a case-insensitive substring of its name or hint.

import type { ReactNode } from 'react';

export interface SearchOption {
    value: string;
    name: string;
    /** Beside the name, and searched with it. */
    hint?: string;
    /** Beside the name on wider screens, not searched. */
    meta?: string;
    icon: ReactNode;
    /** Whether a filter's option is on; other options leave it out. */
    on?: boolean;
    /** May return the option the highlight moves to. */
    select: () => string | void;
}

export interface SearchGroup {
    label: string;
    options: SearchOption[];
}

export const wordsOf = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

export function matchingGroups(groups: readonly SearchGroup[], query: string): SearchGroup[] {
    const words = wordsOf(query);
    const matches = ({ name, hint = '' }: SearchOption) =>
        words.every((word) => `${name} ${hint}`.toLowerCase().includes(word));

    return groups
        .map(({ label, options }) => ({ label, options: options.filter(matches) }))
        .filter(({ options }) => options.length);
}
