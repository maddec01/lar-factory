// The title bar's List button and the List modal it opens, on the design system's Modal's paned layout. The left pane picks
// All Projects or a repository, each with how many of its items match the search and filters;
// the right pane shows the chosen group's items with the search, Add item, Scope board, the sort menu and the filters. It starts on
// the board's scope. An item opens the item dialog and Add item opens the Add item flow, each over the List modal, so
// closing them comes back to the List as it was.

import { boardSections, readingScope } from '@lar-factory/shared';
import type { ListGroup } from '@lar-factory/shared';
import { Button, Badge, Input, Modal, SidebarNavigationGroup, SidebarPane } from '@lar-works/design-system';
import { Inbox, SquarePen } from '@lar-works/design-system/icons';
import { useRef, useState } from 'react';

import { GroupItem, ItemRow } from './ListRows';
import { matchesSearch } from './ListSearch';
import { SORTS } from './ListSorts';
import type { Sort } from './ListSorts';
import { useListStore } from './ListStore';
import { SortMenu } from './SortMenu';
import { useFocusSearchWhenOpenerGoes } from './useFocusSearchWhenOpenerGoes';
import { useAddItemStore } from '@/features/add-item';
import { ItemFilterBar, filtering, rowFilter, useItemFilters, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { EXPANDED, ExpandButton, useExpand, dialogPreference } from '@/shared/ui/expand-dialog/ExpandDialog';
import { Loader } from '@/shared/ui/loading/Loader';

function ListModal({ onClose }: { onClose: () => void }) {
    const childOpen = useItemDialogStore((state) => state.itemId !== null);
    const addOpen = useAddItemStore((state) => state.open);
    const [expanded, toggleExpanded] = useExpand(childOpen || addOpen, dialogPreference('openList'));
    const data = useBoardStore((state) => state.data);
    const now = useBoardStore((state) => state.now);
    const scope = useShownScope();
    const setScope = useScopeStore((state) => state.setScope);
    const [query, setQuery] = useState('');
    // The chosen group's repository, or `null` for All Projects.
    const [pick, setPick] = useState<string | null>(scope);
    const [sort, setSort] = useState<Sort | null>(null);
    const searchField = useRef<HTMLInputElement>(null);

    useFocusSearchWhenOpenerGoes(searchField);

    const [filters, setFilters] = useItemFilters();
    const q = query.trim().toLowerCase();
    const shows = rowFilter(filters, data.repos);
    // In boardSections' order, which counts items before the search so the rows stay put while typing.
    const held = boardSections(data, now).listGroups;
    const groups = held.map((group): ListGroup => ({
        ...group,
        items: group.items.filter((i) => matchesSearch(i, q) && shows(i)),
    }));
    // A picked group that's gone shows All Projects.
    const picked = groups.find((group) => group.repo === pick);
    const active = picked?.repo ?? null;
    const unsorted = picked ? [...picked.items] : groups.flatMap((group) => group.items);
    const effectiveSort = sort ?? (unsorted.some((item) => item.azure) ? 'priority' : 'updated');
    const items = unsorted.sort(SORTS[effectiveSort].compare);
    const scoped = picked !== undefined && scope === picked.repo;
    // A scope the first read may still add to isn't empty, nor its count final: one repository until its items land, All Projects until the read settles.
    const reading = readingScope(data, picked?.repo);
    const groupItem = ({ repo, name, items: hits }: ListGroup, icon: React.ReactNode) => (
        <GroupItem
            key={repo}
            label={name}
            count={readingScope(data, repo) ? undefined : hits.length}
            icon={icon}
            active={active === repo}
            onPick={() => setPick(repo)}
        />
    );

    return (
        <Modal onClose={onClose}>
            <Modal.Content
                data-list-modal
                data-expanded={expanded}
                style={expanded ? EXPANDED : undefined}
                headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}
                title="List"
                focusFirstField
                sidebar={
                    <SidebarPane label="Projects">
                        <GroupItem
                            label="All Projects"
                            count={
                                readingScope(data) ? undefined : groups.reduce((n, group) => n + group.items.length, 0)
                            }
                            icon={<Inbox />}
                            active={active === null}
                            onPick={() => setPick(null)}
                        />
                        <SidebarNavigationGroup label="Projects">
                            {groups.map((group) => groupItem(group, <ProjectIcon repo={group.repo} size="medium" />))}
                        </SidebarNavigationGroup>
                    </SidebarPane>
                }
            >
                <div className="flex shrink-0 flex-col gap-2 px-5 sm:px-6">
                    <div className="flex items-center gap-2">
                        <Input
                            ref={searchField}
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search List"
                            aria-label="Search List items"
                        />
                        <Button
                            {...kind('main')}
                            leftIcon={<SquarePen />}
                            className="add-item shrink-0"
                            onClick={() => useAddItemStore.getState().setOpen(true)}
                        >
                            Add item
                        </Button>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="text-base-content truncate text-sm font-semibold">
                            {picked ? picked.name : 'All Projects'}
                        </span>
                        {!reading && <Badge>{items.length}</Badge>}
                        {picked && (
                            <Button
                                {...kind('other')}
                                data-toggle
                                className="scope-board"
                                aria-pressed={scoped}
                                selected={scoped}
                                onClick={() => setScope(scoped ? null : picked.repo)}
                            >
                                {scoped ? 'Board scoped' : 'Scope board'}
                            </Button>
                        )}
                        <SortMenu sort={effectiveSort} onSort={setSort} />
                    </div>
                    <ItemFilterBar
                        filters={filters}
                        onChange={setFilters}
                        rows={held
                            .filter((group) => !picked || group.repo === picked.repo)
                            .flatMap((group) => group.items)}
                    />
                </div>
                <Modal.Body>
                    {items.map((item) => (
                        <ItemRow
                            key={item.id}
                            item={item}
                            now={now}
                            showRepo={!picked}
                            onOpen={() => useItemDialogStore.getState().open(item.id, true)}
                        />
                    ))}
                    {!items.length && (
                        <p className="empty text-base-700 m-0 p-4 text-sm">
                            {q || filtering(filters) ? (
                                'Nothing here matches.'
                            ) : reading ? (
                                <Loader label="Loading Projects…" />
                            ) : (
                                'Nothing in List.'
                            )}
                        </p>
                    )}
                    {items.length > 0 && reading && (
                        <p className="text-base-700 m-0 p-4 text-sm" data-reading>
                            <Loader label="Loading more Projects…" />
                        </p>
                    )}
                </Modal.Body>
            </Modal.Content>
        </Modal>
    );
}

/** "List <count>", the count being the items in List, or a loading cue for none while the first read could add some; it opens the List modal. */
export function ListButton() {
    const count = useBoardStore((state) => state.data.items.filter((item) => item.status === 'List').length);
    const reading = useBoardStore((state) => readingScope(state.data));
    const open = useListStore((state) => state.open);
    const setOpen = useListStore((state) => state.setOpen);

    return (
        <>
            <Button
                {...kind('control')}
                className="list-button px-2"
                leftIcon={<Inbox />}
                title="List"
                onClick={() => setOpen(true)}
            >
                <span className="@max-[70rem]:sr-only">List</span>
                {count || !reading ? <Badge>{count}</Badge> : <Loader title="Loading Projects…" />}
            </Button>
            {open && <ListModal onClose={() => setOpen(false)} />}
        </>
    );
}
