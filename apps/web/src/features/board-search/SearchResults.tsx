// Everything the board search lists for a query, in list order: actions, then the filters, then tickets once there is a
// query (SearchTickets.tsx), those on the board and then the List's, then Settings entries. Tokens narrow tickets alone,
// and Search all tickets lists what they hide. Tickets are the board's items, Done's only within its 7-day window.
// Archive stays off the board data, so nothing archived shows.

import { readingScope, repoName, shownRepo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Archive, Inbox, ListX, SquarePen, TicketPlus } from '@lar-works/design-system/icons';
import type { LucideIcon } from '@lar-works/design-system/icons';

import { matchingGroups, wordsOf } from './SearchOptions';
import type { SearchGroup, SearchOption } from './SearchOptions';
import { ticketGroups, ticketOptions } from './SearchTickets';
import { settingMatches } from './SettingMatches';
import { useAddItemStore } from '@/features/add-item';
import type { ItemFilters } from '@/features/filters';
import { useListStore } from '@/features/list';
import { ProjectIcon, projectSettings } from '@/features/repositories';
import { pages, settingsData, useSettingsStore } from '@/features/settings';
import type { PagesInput } from '@/features/settings';
import { useUpdateStore } from '@/features/updates';
import type { UpdateButtonAction } from '@/features/updates';
import { conceptIcons } from '@/ui/board';

export interface SearchInput {
    data: BoardData;
    now: number;
    query: string;
    scope: string | null;
    filters: ItemFilters;
    /** Whether Search all tickets was chosen for this query. */
    widened: boolean;
    /** Whether More settings was chosen for this query, listing every Settings match. */
    allSettings?: boolean;
    /** The groups that set the filters. */
    filterGroups: readonly SearchGroup[];
    /** Whether any filter token is on, Scope included. */
    filtering: boolean;
    /** The Update pill's next step. */
    update: UpdateButtonAction;
    /** What `settingsOptions` lists, which the query doesn't change. */
    settingOptions: SearchOption[];
    /** The word the board's rows say for an item (the item presenter's); its recorded status without one. */
    wordOf?: (item: Item) => string;
}

export interface SearchHandlers {
    /** Closes the dialog, then does `run`. */
    leave: (run: () => void) => void;
    /** Clears every filter, with the dialog open. */
    clear: () => void;
    /** Lists the tickets the tokens hide. */
    widen: () => void;
    /** Lists every Settings match. */
    moreSettings?: () => void;
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
        leaving('action:settings', 'Settings', conceptIcons.settings, () => openSettings()),
        ...(update === 'none'
            ? []
            : [
                  leaving(
                      'action:update',
                      update === 'install' ? 'Restart to update' : 'Download the update',
                      conceptIcons.updates,
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
    settings: Pick<PagesInput, 'app' | 'version'>,
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
                    .filter((row) => !row.noteOnly && page.id !== 'projects')
                    .map((row) => ({
                        ...entry,
                        value: `setting:${page.id}:${row.id}`,
                        name: row.title,
                        keywords: row.keywords,
                        hint: page.label,
                    })),
            ];
        },
    );
    const projects = data.repos
        .filter((repo) => repo.setup)
        .flatMap(({ repo }) => {
            // Its short name, as the board names it; the full one stays searchable.
            const name = repoName(repo, data.repos);
            const entry = {
                icon: <ProjectIcon repo={repo} size="md" />,
                select: () =>
                    leave(() => {
                        useSettingsStore.getState().openProject(repo);
                        useSettingsStore.getState().setOpen(true);
                    }),
            };

            return [
                {
                    ...entry,
                    value: `project:${repo}`,
                    name: `Settings for ${name}`,
                    hint: 'Project settings',
                    keywords: shownRepo(repo),
                },
                ...projectSettings(repo).map((setting) => ({
                    ...entry,
                    value: `project:${repo}:${setting.id}`,
                    name: setting.label,
                    hint: name,
                    keywords: shownRepo(repo),
                })),
            ];
        });

    return [...general, ...projects];
}

/** What the dialog lists for `input`, and whether the first read may still add tickets to it: actions and filters,
 *  then the items (what a query is usually for), then a few Settings matches. */
export function searchResults(
    input: SearchInput,
    handlers: SearchHandlers,
): { groups: SearchGroup[]; reading: boolean } {
    const { data, query, scope, widened, filterGroups } = input;
    const typed = wordsOf(query).length > 0;
    const tickets = typed ? ticketOptions(input, handlers) : [];
    const settings = typed
        ? settingMatches(input.settingOptions, input.query, input.allSettings ?? false, handlers.moreSettings)
        : [];

    return {
        groups: [
            ...matchingGroups([{ label: 'Actions', options: actions(input, handlers) }, ...filterGroups], query),
            ...ticketGroups(tickets, data),
            ...(settings.length ? [{ label: 'Settings', options: settings }] : []),
        ],
        reading: typed && readingScope(data, widened ? undefined : (scope ?? undefined)),
    };
}
