// The builds that count toward the build limit and what each is doing, from the one item-state presenter, so the Build
// heading, the title bar's Building counter and the rows under them say the same, in numbers a reader can add up.
// Capacity and execution are different: recorded builds count toward the shared limit even while idle, and a build at
// work the records don't hold takes no slot, so the count names it apart ("0 of 2 build slots · 2 more working"). A
// build with an open PR waits on that PR and holds no slot, idle or fixing CI, so the count names it apart too
// ("1 of 2 build slots · 2 waiting on their PR").

import { buildsAtWork, limitNumber, plural } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { useBoardUnavailable, useItemStates } from './ItemState';
import type { ItemState } from './ItemState';
import { useBoardStore } from '@/services/board/board.hooks';

export const BUILD_LIMIT_NOTE =
    "The limit counts pending starts and reserves a slot for every started build, including questions and approval waits, until its PR opens, completion or set-aside. A build with an open PR doesn't count, even while it fixes CI or review feedback. The limit holds automatic starts; you can override it with Start build on an item.";

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

/** "4 count toward the limit: 2 working, 1 stopped, 1 PR merged · 2 over the shared limit", each part a row's word. */
function buildsAgainstLimit(states: readonly ItemState[], limit: number | undefined): string {
    const counts = new Map<string, number>();

    for (const state of states) counts.set(inSentence(state), (counts.get(inSentence(state)) ?? 0) + 1);

    const parts = [...counts].sort(([, a], [, b]) => b - a).map(([word, n]) => `${n} ${word}`);
    const building = states.length;

    return `${building} builds open${limit === undefined ? '' : ` · shared limit ${limit}`}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** The builds at work, each with its state, the limit, and the sentence that counts them. */
export function useBuilds(): {
    items: Item[];
    running: number;
    limit: number | undefined;
    /** Builds with an open PR: they wait on it and hold no slot, so the count names them apart. */
    waiting: Item[];
    text: string;
    occupancy: string;
} {
    const data = useBoardStore((state) => state.data);
    const unavailable = useBoardUnavailable();
    const states = useItemStates();
    const items = buildsAtWork(data, unavailable);
    const shown = items.map(states);
    const limit = data.buildLimit && limitNumber(data.buildLimit);
    // Builds at work that hold no slot, such as work the board has no record of starting: the count says them apart,
    // so "0 of 2 build slots" never sits over rows that say Working with nothing to explain it.
    const counted = new Set(items.map((item) => item.id));
    const atWork = (state: ItemState) => state.running || state.execution === 'working' || state.word === 'Working';
    const uncounted = data.items.filter((item) => !counted.has(item.id) && BUILD_STATUSES.includes(item.status));
    const waiting = uncounted.filter(
        (item) => item.recorded !== false && !item.setAside && !item.archived && item.linkedPrs[0]?.state === 'open',
    );
    const unslotted = uncounted.filter((item) => !waiting.includes(item) && atWork(states(item))).length;
    const more = `${unslotted ? ` · ${unslotted} more working` : ''}${waiting.length ? ` · ${waiting.length} waiting on their PR` : ''}`;

    return {
        items,
        running: shown.filter((state) => state.running).length,
        limit,
        waiting,
        text: `${buildsAgainstLimit(shown, limit)}${unslotted ? `; ${plural(unslotted, 'more build')} working without a slot, which the board's records don't hold` : ''}${waiting.length ? `; ${plural(waiting.length, 'build')} waiting on their PR, which ${waiting.length === 1 ? "doesn't" : "don't"} count` : ''}`,
        occupancy:
            limit === undefined
                ? `${items.length} building${more}`
                : items.length > limit
                  ? `${items.length} building · ${items.length - limit} over the limit${more}`
                  : `${items.length} of ${limit} build slots${more}`,
    };
}

/** The statuses of a build under way, whose rows sit in the Build lane. */
const BUILD_STATUSES: readonly Item['status'][] = ['In progress', 'Review', 'Verify', 'Ready to merge'];
