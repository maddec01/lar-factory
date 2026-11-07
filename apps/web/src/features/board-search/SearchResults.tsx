// Everything the board search lists for a query, in list order: actions, then the filters, then Settings entries and
// tickets once there is a query. Tokens narrow tickets alone, and Search all tickets lists what they hide. Tickets are
// the board's items, Done's only within its 7-day window. Archive stays off the board data, so nothing archived shows.

import {
    byFlowOrder,
    inRepo,
    isRecentlyDone,
    readingScope,
    ref,
    repoKey,
    repoName,
    shownRepo,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import {
    Archive,
    Inbox,
    ListX,
    RefreshCw,
    Search,
    Settings2,
    SquarePen,
    TicketPlus,
} from '@lar-works/design-system/icons';
import type { LucideIcon } from '@lar-works/design-system/icons';

import { KindIcon } from './BoardFilters';
import { matchingGroups, wordsOf } from './SearchOptions';
import type { SearchGroup, SearchOption } from './SearchOptions';
import { useAddItemStore } from '@/features/add-item';
import { kindFilterOf, rowFilter } from '@/features/filters';
import type { ItemFilters } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import { matchesSearch, useListStore } from '@/features/list';
import { projectSettings } from '@/features/repositories';
import { pages, settingsData, useSettingsStore } from '@/features/settings';
import type { PagesInput } from '@/features/settings';
import { useUpdateStore } from '@/features/updates';
import type { UpdateButtonAction } from '@/features/updates';

export interface SearchInput {
    data: BoardData;
    now: number;
    query: string;
    scope: string | null;
    filters: ItemFilters;
    /** Whether Search all tickets was chosen for this query. */
    widened: boolean;
    /** The groups that set the filters. */
    filterGroups: readonly SearchGroup[];
    /** Whether any filter token is on, Scope included. */
    filtering: boolean;
    /** The Update pill's next step. */
    update: UpdateButtonAction;
    /** What `settingsOptions` lists, which the query doesn't change. */
    settingOptions: SearchOption[];
}

export interface SearchHandlers {
    /** Closes the dialog, then does `run`. */
    leave: (run: () => void) => void;
    /** Clears every filter, with the dialog open. */
    clear: () => void;
    /** Lists the tickets the tokens hide. */
    widen: () => void;
}

const icon = (Icon: LucideIcon) => <Icon aria-hidden="true" />;

const openSettings = (section?: string) => {
    const store = useSettingsStore.getState();

    if (section) store.setSection(section);

    store.setOpen(true);
};

const addItem = (pane: 'new' | 'pick') => {
    const store = useAddItemStore.getState();

    store.setPane(pane);
    store.setOpen(true);
};

function actions({ query, filtering, update }: SearchInput, { leave, clear }: SearchHandlers): SearchOption[] {
    const leaving = (value: string, name: string, Icon: LucideIcon, run: () => void): SearchOption => ({
        value,
        name,
        icon: icon(Icon),
        select: () => leave(run),
    });

    return [
        leaving('action:add', 'Add item', SquarePen, () => addItem('new')),
        leaving('action:list', 'List', Inbox, () => useListStore.getState().setOpen(true)),
        leaving('action:settings', 'Settings', Settings2, () => openSettings()),
        ...(update === 'none'
            ? []
            : [
                  leaving(
                      'action:update',
                      update === 'install' ? 'Restart to update' : 'Download the update',
                      RefreshCw,
                      () => void useUpdateStore.getState().run(),
                  ),
              ]),
        ...(wordsOf(query).length
            ? [
                  leaving('action:pick', 'Add item from a ticket', TicketPlus, () => addItem('pick')),
                  leaving('action:archive', 'Archive', Archive, () => openSettings('archive')),
                  ...(filtering
                      ? [{ value: 'action:clear', name: 'Clear filters', icon: icon(ListX), select: clear }]
                      : []),
              ]
            : []),
    ];
}

/** Each page by its label and each of its rows that holds a setting by its title, opening Settings on that page. */
export function settingsOptions(
    data: BoardData,
    settings: Pick<PagesInput, 'app' | 'targets' | 'version'>,
    leave: SearchHandlers['leave'],
): SearchOption[] {
    const general = pages({ ...settings, data: settingsData(data), archive: { items: null, problem: null } }).flatMap(
        (page) => {
            const entry = {
                icon: page.icon,
                select: () => leave(() => openSettings(page.id)),
            };

            return [
                { ...entry, value: `section:${page.id}`, name: page.label },
                ...page.groups
                    .flatMap((group) => group.rows)
                    .filter((row) => !row.noteOnly)
                    .map((row) => ({
                        ...entry,
                        value: `setting:${page.id}:${row.id}`,
                        name: row.title,
                        hint: page.label,
                    })),
            ];
        },
    );
    const projects = data.repos
        .filter((repo) => repo.setup)
        .flatMap(({ repo }) => {
            const name = shownRepo(repo);
            const entry = {
                icon: icon(Settings2),
                select: () =>
                    leave(() => {
                        useSettingsStore.getState().openProject(repo);
                        useSettingsStore.getState().setOpen(true);
                    }),
            };

            return [
                { ...entry, value: `project:${repo}`, name, hint: 'Projects' },
                ...projectSettings(repo).map((setting) => ({
                    ...entry,
                    value: `project:${repo}:${setting.id}`,
                    name: setting.label,
                    hint: name,
                })),
            ];
        });

    return [...general, ...projects];
}

const ticketValue = (item: Item) => `ticket:${item.id}`;

function ticketOption(item: Item, data: BoardData, leave: SearchHandlers['leave']): SearchOption {
    return {
        value: ticketValue(item),
        name: item.title,
        ...(item.number ? { hint: ref(item) } : {}),
        meta: `${repoName(repoKey(item), data.repos)} · ${item.status}`,
        icon: <KindIcon choice={kindFilterOf(item)} />,
        select: () => leave(() => useItemDialogStore.getState().open(item.id)),
    };
}

function ticketOptions(
    { data, now, query, scope, filters, widened }: SearchInput,
    { leave, widen }: SearchHandlers,
): SearchOption[] {
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
    const option = (item: Item) => ticketOption(item, data, leave);

    if (widened) return [...shown, ...hidden].map(option);

    return [
        ...shown.map(option),
        ...(hidden.length
            ? [
                  {
                      value: 'tickets:all',
                      name: 'Search all tickets',
                      hint: `${hidden.length} more`,
                      icon: icon(Search),
                      select: () => {
                          widen();

                          return ticketValue(hidden[0]!);
                      },
                  },
              ]
            : []),
    ];
}

/** What the dialog lists for `input`, and whether the first read may still add tickets to it. */
export function searchResults(
    input: SearchInput,
    handlers: SearchHandlers,
): { groups: SearchGroup[]; reading: boolean } {
    const { data, query, scope, widened, filterGroups, settingOptions } = input;
    const typed = wordsOf(query).length > 0;
    const options: SearchGroup[] = [
        { label: 'Actions', options: actions(input, handlers) },
        ...filterGroups,
        ...(typed ? [{ label: 'Settings', options: settingOptions }] : []),
    ];
    const tickets = typed ? ticketOptions(input, handlers) : [];

    return {
        groups: [
            ...matchingGroups(options, query),
            ...(tickets.length ? [{ label: 'Tickets', options: tickets }] : []),
        ],
        reading: typed && readingScope(data, widened ? undefined : (scope ?? undefined)),
    };
}
