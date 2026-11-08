// The builds that count toward the build limit and what each is doing, from the one item-state presenter, so the Build
// heading, the title bar's Building counter and the rows under them say the same, in numbers a reader can add up.
// Capacity and execution are different: recorded builds count toward the automatic limit even while idle.

import { buildsAtWork, limitNumber } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { useBoardUnavailable, useItemStates } from './ItemState';
import type { ItemState } from './ItemState';
import { useBoardStore } from '@/services/board/board.hooks';

export const BUILD_LIMIT_NOTE =
    'The limit counts pending build starts and items still in Build or Review, including stopped builds and merged PRs awaiting a board update. Work in Verify or Merge counts while a build runs again.';

/** A state's word inside a sentence: "working", "stopped", "PR merged", "in review", "starting". */
const inSentence = ({ word, stage, execution }: ItemState): string =>
    word === 'PR merged' || word === 'Merged'
        ? 'waiting to close'
        : execution === 'starting'
          ? 'starting'
          : word === stage
            ? `in ${stage.toLowerCase()}`
            : word.startsWith('PR')
              ? word
              : word.toLowerCase();

/** "4 count toward the limit: 2 working, 1 stopped, 1 PR merged · 2 over the automatic limit", each part a row's word. */
function buildsAgainstLimit(states: readonly ItemState[], limit: number | undefined): string {
    const counts = new Map<string, number>();

    for (const state of states) counts.set(inSentence(state), (counts.get(inSentence(state)) ?? 0) + 1);

    const parts = [...counts].sort(([, a], [, b]) => b - a).map(([word, n]) => `${n} ${word}`);
    const building = states.length;

    return `${building} builds open${limit === undefined ? '' : ` · automatic limit ${limit}`}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** The builds at work, each with its state, the limit, and the sentence that counts them. */
export function useBuilds(): { items: Item[]; running: number; limit: number | undefined; text: string } {
    const data = useBoardStore((state) => state.data);
    const unavailable = useBoardUnavailable();
    const states = useItemStates();
    const items = buildsAtWork(data, unavailable);
    const shown = items.map(states);
    const limit = data.buildLimit && limitNumber(data.buildLimit);

    return {
        items,
        running: shown.filter((state) => state.running).length,
        limit,
        text: buildsAgainstLimit(shown, limit),
    };
}
