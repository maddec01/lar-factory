// What a work-map card says beside its state: its thread's activity in a word, its brief's gate, and what runs below it.

import { plural } from '@lar-factory/shared';

import type { Part, PartActivity } from './DossierParts';

/** A part's thread activity in one word, beside its state. */
export const ACTIVITY_WORD: Record<PartActivity['kind'], string | null> = {
    'needs you': 'Question',
    working: 'Working',
    'child waiting': 'Child waiting',
    stopped: 'Run stopped',
    finished: 'Run finished',
    none: null,
};
/** The brief's gate, from the work record, in the owner's words. */
export const GATE_WORDS = {
    passed: 'Brief approved',
    'not passed': 'Brief not approved',
    unknown: 'Brief approval unknown',
} as const;

/** The statuses where a finished run is news: work it should still be doing. */
export const RUNS: string[] = ['Shaping', 'In progress', 'Review'];

/** What runs below a part now, and any slice held up: its active slices, else its child or background work. */
export function partDetail({ item }: Part, { kind, thread }: PartActivity): string[] {
    const active = item.slices.filter((s) => s.progress === 'active').length;
    const blocked = item.slices.filter((s) => s.progress === 'blocked').length;

    return [
        ...(active
            ? [`${plural(active, 'slice')} active`]
            : kind === 'working' && thread?.hasRunningChildren
              ? ['child work running']
              : []),
        ...(blocked ? [`${plural(blocked, 'slice')} blocked`] : []),
    ];
}
