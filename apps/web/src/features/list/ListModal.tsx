// The title bar's List button and the list modal it opens, on the design system's Modal's paned layout. The left pane picks
// All projects or a repository, each with how many of its items match the search and filters; the right pane shows the
// chosen group's items under one row of the search, the filters, Scope board, the sort menu and Add item. It starts on
// the board's scope. An item opens the item dialog and Add item opens the Add item flow, each over the list modal, so
// closing them comes back to the list as it was.

import type { ListGroup } from '@lar-factory/shared';
import { boardSections, readingScope, repoKey } from '@lar-factory/shared';
import {
    Button,
    EmptyState,
    Input,
    Loading,
    Modal,
    SidebarNavigationGroup,
    SidebarPane,
    SortMenu,
} from '@lar-works/design-system';
import { Inbox, SquarePen } from '@lar-works/design-system/icons';
import { useRef, useState } from 'react';

import { listRowLabels } from './ListRowFacts';
import { ItemRow } from './ListRows';
import { matchesSearch } from './ListSearch';
import type { Sort } from './ListSorts';
import { SORT_OPTIONS, SORTS } from './ListSorts';
import { useListStore } from './ListStore';
import { useFocusSearchWhenOpenerGoes } from './useFocusSearchWhenOpenerGoes';
import { useAddItemStore } from '@/features/add-item';
import { filtering, ItemFilterBar, rowFilter, useItemFilters, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { ExpandButton } from '@/shared/dialogs/ExpandDialog';
import { dialogPreference, useExpand } from '@/shared/dialogs/useExpand';
import {
    buttonKind,
    ListButton as TitleBarListButton,
    ListGroupItem as GroupItem,
    ListHeader,
    ListNote,
    ListResults,
    ListRowGrid,
} from '@/ui/board';

function ListModal({ onClose }: { onClose: () => void }) {
    const childOpen = useItemDialogStore((state) => state.itemId !== null);
    const addOpen = useAddItemStore((state) => state.open);
    const [expanded, toggleExpanded] = useExpand(childOpen || addOpen, dialogPreference('openList'));
    const data = useBoardStore((state) => state.data);
    const now = useBoardStore((state) => state.now);
    const scope = useShownScope();
    const setScope = useScopeStore((state) => state.setScope);
    const [query, setQuery] = useState('');
    // The chosen group's repository, or `null` for All projects.
    const [pick, setPick] = useState<string | null>(scope);
    const [sort, setSort] = useState<Sort | null>(null);
    const searchField = useRef<HTMLInputElement>(null);

    useFocusSearchWhenOpenerGoes(searchField);

    const [filters, setFilters] = useItemFilters();
    const q = query.trim().toLowerCase();
    const shows = rowFilter(filters, data.repos);
    // In boardSections' order, which counts items before the search so the rows stay put while typing.
    const held = boardSections(data, now).listGroups;
    const listed = held.some((group) => group.items.length > 0);
    const groups = held.map((group): ListGroup => ({
        ...group,
        items: group.items.filter((i) => matchesSearch(i, q) && shows(i)),
    }));
    // A picked group that's gone shows All projects.
    const picked = groups.find((group) => group.repo === pick);
    const active = picked?.repo ?? null;
    const unsorted = picked ? [...picked.items] : groups.flatMap((group) => group.items);
    const effectiveSort = sort ?? (unsorted.some((item) => item.azure) ? 'priority' : 'updated');
    const items = unsorted.sort(SORTS[effectiveSort].compare);
    // A row names its project only while the rows shown come from more than one.
    const mixed = new Set(items.map(repoKey)).size > 1;
    // Every row keeps a labels column while any row shown has a label, so the columns line up down the list.
    const labelColumn = items.some((item) => listRowLabels(item, data.repos).length > 0);
    const scoped = picked !== undefined && scope === picked.repo;
    // A scope the first read may still add to isn't empty, nor its count final: one repository until its items land, All projects until the read settles.
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
                // An item opened from the List hides it, so a shorter item dialog never shows the List around its edges.
                data-under-item={childOpen || undefined}
                data-expanded={expanded}
                expanded={expanded}
                headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />}
                title="List"
                focusFirstField
                sidebar={
                    <SidebarPane label="Projects">
                        <GroupItem
                            label="All projects"
                            count={
                                readingScope(data) ? undefined : groups.reduce((n, group) => n + group.items.length, 0)
                            }
                            icon={<Inbox />}
                            active={active === null}
                            onPick={() => setPick(null)}
                        />
                        <SidebarNavigationGroup label="Projects">
                            {groups.map((group) => groupItem(group, <ProjectIcon repo={group.repo} size="md" />))}
                        </SidebarNavigationGroup>
                    </SidebarPane>
                }
            >
                <Modal.Body layout="fill">
                    <ListHeader
                        search={
                            <Input
                                ref={searchField}
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search the List"
                                aria-label="Search the List"
                            />
                        }
                        add={
                            <Button
                                {...buttonKind('other', { size: 'md' })}
                                leftIcon={<SquarePen />}
                                data-add-item
                                onClick={() => useAddItemStore.getState().setOpen(true)}
                            >
                                Add item
                            </Button>
                        }
                        scope={
                            picked && (
                                <Button
                                    {...buttonKind('other')}
                                    data-toggle
                                    data-scope-board
                                    aria-pressed={scoped}
                                    selected={scoped}
                                    onClick={() => setScope(scoped ? null : picked.repo)}
                                >
                                    {scoped ? 'Board scoped' : 'Scope board'}
                                </Button>
                            )
                        }
                        // Sorting and filters wait until there is something to sort or filter.
                        sort={listed && <SortMenu value={effectiveSort} options={SORT_OPTIONS} onChange={setSort} />}
                        filters={
                            listed && (
                                <ItemFilterBar
                                    filters={filters}
                                    onChange={setFilters}
                                    rows={held
                                        .filter((group) => !picked || group.repo === picked.repo)
                                        .flatMap((group) => group.items)}
                                />
                            )
                        }
                    />
                    <ListResults>
                        {items.length > 0 && (
                            <ListRowGrid labels={labelColumn} project={!picked && mixed}>
                                {items.map((item) => (
                                    <ItemRow
                                        key={item.id}
                                        item={item}
                                        now={now}
                                        showRepo={!picked && mixed}
                                        labelColumn={labelColumn}
                                        onOpen={() => useItemDialogStore.getState().open(item.id, true)}
                                    />
                                ))}
                            </ListRowGrid>
                        )}
                        {!items.length &&
                            (q || filtering(filters) ? (
                                <EmptyState
                                    size="compact"
                                    title="Nothing matches"
                                    description="Try another search or clear it to see all items."
                                    actions={
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                setQuery('');
                                                setFilters({ kinds: [], labels: [] });
                                                searchField.current?.focus();
                                            }}
                                        >
                                            Clear search
                                        </Button>
                                    }
                                />
                            ) : reading ? (
                                <ListNote>
                                    <Loading presentation="inline" label="Loading projects…" />
                                </ListNote>
                            ) : (
                                <EmptyState
                                    size="compact"
                                    title="Nothing on the List yet"
                                    description="Work you add or tickets you find wait here until you queue them."
                                />
                            ))}
                        {items.length > 0 && reading && (
                            <ListNote reading>
                                <Loading presentation="inline" label="Loading more Projects…" />
                            </ListNote>
                        )}
                    </ListResults>
                </Modal.Body>
            </Modal.Content>
        </Modal>
    );
}

/** "List <count>", the count being the items in the list, or a loading cue for none while the first read could add some; it opens the list modal. */
export function ListButton() {
    const count = useBoardStore((state) => state.data.items.filter((item) => item.status === 'List').length);
    const reading = useBoardStore((state) => readingScope(state.data));
    const open = useListStore((state) => state.open);
    const setOpen = useListStore((state) => state.setOpen);

    return (
        <>
            <TitleBarListButton
                label="List"
                icon={<Inbox />}
                count={count || !reading ? count : undefined}
                loadingLabel="Loading projects…"
                onOpen={() => setOpen(true)}
            />
            {open && <ListModal onClose={() => setOpen(false)} />}
        </>
    );
}
