// The List modal's rows: a group in its left pane and an item in its right pane.

import { ref, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { SidebarNavigationItem } from '@lar-works/design-system';

import { AzureFields, ItemKind, LabelChips, StructureSync, SourceIcon } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

/** A group in the left pane; one with no `count`, as a repository still reading, shows none. */
export function GroupItem({
    label,
    count,
    icon,
    active,
    onPick,
}: {
    label: string;
    count?: number;
    icon: React.ReactNode;
    active: boolean;
    onPick: () => void;
}) {
    return (
        <SidebarNavigationItem active={active} onClick={onPick}>
            {icon}
            <span className="name min-w-0 flex-1 truncate text-left">{label}</span>
            {count !== undefined && <span className="count text-base-700 text-xs tabular-nums">{count}</span>}
        </SidebarNavigationItem>
    );
}

export function ItemRow({
    item,
    now,
    showRepo,
    onOpen,
}: {
    item: Item;
    now: number;
    showRepo: boolean;
    onOpen: () => void;
}) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <button
            type="button"
            onClick={onOpen}
            data-item={item.id}
            title={item.title}
            className="hover:bg-base-200/70 focus-visible:outline-primary flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
            <SourceIcon item={item} />
            <span className="min-w-0 flex-1">
                <span className="text-base-content block truncate text-[13px] leading-5 font-medium">
                    {item.number ? <span className="text-base-700 font-normal">{ref(item)} </span> : null}
                    {item.title}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-base-700 me-1 flex min-w-0 items-center gap-1 text-[11px] leading-4">
                        {showRepo && <ProjectIcon repo={repoKey(item)} size="small" />}
                        <span className="min-w-0 truncate tabular-nums">
                            {showRepo && `${repoName(repoKey(item), repos)} · `}
                            {shortAgo(item.updatedAt, now)}
                        </span>
                    </span>
                    <ItemKind item={item} onRow />
                    <LabelChips item={item} />
                    <StructureSync item={item} />
                </span>
                <AzureFields azure={item.azure} />
            </span>
        </button>
    );
}
