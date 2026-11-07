// The board's filters as the board search shows them: a token for each active Scope, Kind and Labels choice, and the
// options that set them. Labels offers what the items in Scope on your desk and the stages show, whatever the filters
// hide, plus any picked label none of them shows, so it stays removable.

import { boardSections, deskItems, inRepo, repoName, sameLabel, sameRepo } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { ColorDot, type CommandPaletteToken } from '@lar-works/design-system';
import { CircleDashed, Layers } from '@lar-works/design-system/icons';
import { useMemo } from 'react';

import type { SearchGroup } from './SearchOptions';
import {
    kindName,
    KIND_FILTERS,
    headingOf,
    labelChoices,
    toggled,
    useScopeStore,
    useShownScope,
} from '@/features/filters';
import type { ItemFilters, KindFilter } from '@/features/filters';
import { KIND_BADGES, useActivityUnavailable } from '@/features/items';
import { stageRows } from '@/features/line';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

export interface FilterToken extends CommandPaletteToken {
    /** A kind's hue, which colours the closed field's token. */
    hue?: number;
}

export function KindIcon({ choice }: { choice: KindFilter }) {
    const Icon = choice === 'no-kind' ? CircleDashed : KIND_BADGES[choice]!.icon;

    return <Icon aria-hidden="true" />;
}

function LabelDot({ color }: { color: string | undefined }) {
    return <ColorDot color={color} />;
}

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
                      leading: <ProjectIcon repo={scope} size="small" />,
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
            leading: <LabelDot color={colorOf(label)} />,
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
                        name: 'All Projects',
                        icon: <Layers aria-hidden="true" />,
                        on: !scope,
                        select: () => setScope(null),
                    },
                    ...boardSections(data, now).listGroups.map(({ repo, name }) => ({
                        value: `repo:${repo}`,
                        name,
                        icon: <ProjectIcon repo={repo} size="row" />,
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
                    icon: <LabelDot color={color} />,
                    on: labels.some((label) => sameLabel(label, name)),
                    select: () => setFilters({ kinds, labels: toggled(labels, name, sameLabel) }),
                })),
            },
        ];
    }, [data, now, unavailable, scope, filters, setScope, setFilters]);
}
