// The board search's active filter tokens and the groups that set them. Labels keeps picked choices removable even
// when no item in Scope shows them.

import { boardSections, deskItems, inRepo, repoName, sameLabel, sameRepo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { StatusIndicator } from '@lar-works/design-system';
import { Layers } from '@lar-works/design-system/icons';
import { useMemo } from 'react';

import { type FilterToken, KindIcon } from './BoardFilters';
import type { SearchGroup } from './SearchOptions';
import {
    KIND_FILTERS,
    headingOf,
    kindName,
    labelChoices,
    toggled,
    useScopeStore,
    useShownScope,
} from '@/features/filters';
import type { ItemFilters } from '@/features/filters';
import { KIND_BADGES, useActivityUnavailable } from '@/features/items';
import { stageRows } from '@/features/line';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

/** The colour any item on the board gives each picked label, which a label no item in view shows still has. */
const colorsOf = (data: BoardData) => {
    const choices = labelChoices(data.items, data.repos);

    return (label: string) => choices.find(({ name }) => sameLabel(name, label))?.color;
};

const NO_FILTERS: ItemFilters = { kinds: [], labels: [] };

/** The active filters' tokens, last chosen last within each of Scope, Kind and Labels, and what clears them all. */
export function useFilterTokens(): { tokens: FilterToken[]; clear: () => void } {
    const data = useBoardStore((state) => state.data);
    const scope = useShownScope();
    const { kinds, labels } = useScopeStore((state) => state.filters);
    const setScope = useScopeStore((state) => state.setScope);
    const setFilters = useScopeStore((state) => state.setFilters);
    const removing = (label: string, onRemove: () => void) => ({ remove: { label: `Remove ${label}`, onRemove } });
    const named = scope ? repoName(scope, data.repos) : null;
    const colorOf = colorsOf(data);
    const tokens: FilterToken[] = [
        ...(scope && named
            ? [
                  {
                      id: 'repo',
                      label: named,
                      leading: <ProjectIcon repo={scope} size="sm" />,
                      ...removing(named, () => setScope(null)),
                  },
              ]
            : []),
        ...kinds.map((choice): FilterToken => ({
            id: `kind:${choice}`,
            label: kindName(choice),
            leading: <KindIcon choice={choice} />,
            ...(choice !== 'no-kind' && { hue: KIND_BADGES[choice]!.hue }),
            ...removing(kindName(choice), () => setFilters({ kinds: toggled(kinds, choice), labels })),
        })),
        ...labels.map((label): FilterToken => ({
            id: `label:${label}`,
            label,
            leading: <StatusIndicator tone="neutral" labelColor={colorOf(label)} />,
            ...removing(label, () => setFilters({ kinds, labels: toggled(labels, label, sameLabel) })),
        })),
    ];

    return {
        tokens,
        clear: () => {
            // A saved repository off the board shows no token, so it stays saved for when it returns.
            if (scope) setScope(null);

            setFilters(NO_FILTERS);
        },
    };
}

/** The items in Scope on your desk and the stages. */
function itemsInView(items: Item[], data: BoardData, unavailable: boolean): Item[] {
    const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);

    return [
        ...deskItems({ ...data, items }, unavailable),
        ...[...queue, ...shaping, ...ready, ...build].map(({ item }) => item),
        ...dock.map(({ parent }) => parent),
    ];
}

/** The groups that set the filters: repositories, kinds and labels. */
export function useFilterGroups(): SearchGroup[] {
    const data = useBoardStore((state) => state.data);
    const now = useBoardStore((state) => state.now);
    const unavailable = useActivityUnavailable();
    const scope = useShownScope();
    const setScope = useScopeStore((state) => state.setScope);
    const filters = useScopeStore((state) => state.filters);
    const setFilters = useScopeStore((state) => state.setFilters);

    // Typing in the dialog rerenders this, and none of it depends on the query.
    return useMemo(() => {
        const { kinds, labels } = filters;
        const rows = itemsInView(
            scope ? data.items.filter((item) => inRepo(item, scope)) : data.items,
            data,
            unavailable,
        );
        const choices = labelChoices(rows, data.repos);
        const unseen = labels.filter((label) => !choices.some(({ name }) => sameLabel(name, label)));
        const colorOf = colorsOf(data);
        const labelOptions = [...choices, ...unseen.map((name) => ({ name, color: colorOf(name) }))].sort((a, b) =>
            a.name.localeCompare(b.name),
        );

        return [
            {
                label: 'Projects',
                options: [
                    {
                        value: 'repo:',
                        name: 'All projects',
                        icon: <Layers aria-hidden="true" />,
                        on: !scope,
                        select: () => setScope(null),
                    },
                    ...[
                        ...new Map(
                            boardSections(data, now).listGroups.map((group) => [group.repo.toLowerCase(), group]),
                        ).values(),
                    ].map(({ repo, name }) => ({
                        value: `repo:${repo}`,
                        name,
                        keywords: 'Projects',
                        icon: <ProjectIcon repo={repo} size="md" />,
                        on: !!scope && sameRepo(repo, scope),
                        select: () => setScope(repo),
                    })),
                ],
            },
            {
                label: 'Kinds',
                options: KIND_FILTERS.map((choice) => ({
                    value: `kind:${choice}`,
                    name: kindName(choice),
                    icon: <KindIcon choice={choice} />,
                    on: kinds.includes(choice),
                    select: () => setFilters({ kinds: toggled(kinds, choice), labels }),
                })),
            },
            {
                label: headingOf(rows),
                options: labelOptions.map(({ name, color }) => ({
                    value: `label:${name.toLowerCase()}`,
                    name,
                    icon: <StatusIndicator tone="neutral" labelColor={color} />,
                    on: labels.some((label) => sameLabel(label, name)),
                    select: () => setFilters({ kinds, labels: toggled(labels, name, sameLabel) }),
                })),
            },
        ];
    }, [data, now, unavailable, scope, filters, setScope, setFilters]);
}
