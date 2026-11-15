// The board search's tickets: each as the board says it, open work on the board, then the List's, then what finished
// recently, and Search all tickets for what the tokens hide.

import {
    byFlowOrder,
    deskItems,
    deskWait,
    inRepo,
    isRecentlyDone,
    placementOf,
    repoKey,
    repoName,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Search } from '@lar-works/design-system/icons';

import { wordsOf } from './SearchOptions';
import type { SearchGroup, SearchOption } from './SearchOptions';
import type { SearchHandlers, SearchInput } from './SearchResults';
import { rowFilter } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import { isDone, partRef, partState, RowKindMark } from '@/features/line';
import { matchesSearch } from '@/features/list';

const ticketValue = (item: Item) => `ticket:${item.id}`;

/** The board's lanes by name, as their headings read. */
const LANES: Record<string, string> = {
    queue: 'Queue',
    shaping: 'Shaping',
    ready: 'Ready to build',
    build: 'Build',
    dock: 'Concepts',
};

/** The lane a desk item sits in on the board, as its desk card names it, else what its row says (`word`). */
const laneOf = (item: Item, data: BoardData, word: string): string => {
    const lane = placementOf(item, {
        starts: data.startProgress?.[item.id],
        unavailable: false,
        all: data.items,
    }).sections.find((section) => section !== 'desk');

    return (lane && LANES[lane]) ?? word;
};

/** A ticket as a board row reads: its kind's mark, then its number and title; at its end its project and what it waits
 *  for when it is on Your desk (`yours`), else the word the board says for it. A List ticket sits under its group's
 *  heading, so it says only its project. */
function ticketOption(
    item: Item,
    { data, wordOf }: SearchInput,
    leave: SearchHandlers['leave'],
    yours: boolean,
): SearchOption {
    // A concept's part says what its parts list row and map card say: Complete once done, else what holds it; any other
    // item its row's word.
    const word = item.parentId ? partState(item, data, wordOf?.(item) ?? item.status) : (wordOf?.(item) ?? item.status);

    return {
        value: ticketValue(item),
        name: partRef(item) ? `${partRef(item)} ${item.title}` : item.title,
        // An item on Your desk says its stage, then what it waits for in the desk's words.
        meta: [
            repoName(repoKey(item), data.repos),
            item.status !== 'List' && (yours ? laneOf(item, data, word) : word),
            yours && deskWait(item, false, data.items).label,
        ]
            .filter((word, i, words) => word && words.indexOf(word) === i)
            .join(' · '),
        icon: <RowKindMark item={item} listed />,
        select: () => leave(() => useItemDialogStore.getState().open(item.id)),
    };
}

export function ticketOptions(input: SearchInput, { leave, widen }: SearchHandlers): SearchOption[] {
    const { data, now, query, scope, filters, widened } = input;
    const words = wordsOf(query);
    const shows = rowFilter(filters, data.repos);
    const kept = (item: Item) => (!scope || inRepo(item, scope)) && shows(item);
    const hits = data.items
        .filter(
            (item) =>
                (item.status !== 'Done' || isRecentlyDone(item, now)) &&
                words.every((word) => matchesSearch(item, word)),
        )
        .sort(byFlowOrder);
    const shown = hits.filter(kept);
    const hidden = hits.filter((item) => !kept(item));
    const desk = new Set(deskItems(data, false).map((item) => item.id));
    const option = (item: Item) => ticketOption(item, input, leave, desk.has(item.id));

    if (widened) return [...shown, ...hidden].map(option);

    return [
        ...shown.map(option),
        ...(hidden.length
            ? [
                  {
                      value: 'tickets:all',
                      name: 'Search all tickets',
                      hint: `${hidden.length} more`,
                      icon: <Search aria-hidden="true" />,
                      select: () => {
                          widen();

                          return ticketValue(hidden[0]!);
                      },
                  },
              ]
            : []),
    ];
}

/** The tickets in three groups: the work on the board, then the List's, then what finished recently (done, merged or set
 *  aside), so a query lands on open work first; Search all tickets at the end. */
export function ticketGroups(tickets: SearchOption[], data: BoardData): SearchGroup[] {
    const listed = new Set(data.items.filter((item) => item.status === 'List').map(ticketValue));
    const finished = new Set(data.items.filter((item) => item.status !== 'List' && isDone(item)).map(ticketValue));
    const board = tickets.filter(
        (option) => !listed.has(option.value) && !finished.has(option.value) && option.value !== 'tickets:all',
    );
    const list = tickets.filter((option) => listed.has(option.value));
    const done = tickets.filter((option) => finished.has(option.value));
    const all = tickets.filter((option) => option.value === 'tickets:all');
    const groups = [
        { label: 'On the board', options: board },
        { label: 'List', options: list },
        { label: 'Recently finished', options: done },
    ].filter((group) => group.options.length > 0);

    // Search all tickets closes the last group, or stands alone when every match is hidden.
    if (all.length) {
        if (groups.length) groups.at(-1)!.options.push(...all);
        else groups.push({ label: 'On the board', options: all });
    }

    return groups;
}
