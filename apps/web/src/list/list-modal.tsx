// The title bar's List button and the List modal it opens, on the copied Modal's paned layout. The left pane picks
// All repositories or a repository, each with how many of its items match the search;
// the right pane shows the chosen group's items with the search, Add item, Scope board and the sort menu. It starts on
// the board's scope. An item opens the item dialog and Add item opens the Add item flow, each over the List modal, so
// closing them comes back to the List as it was.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Inbox, SquarePen } from 'lucide-react';
import { boardSections, ref, repoKey, repoName, shortAgo, stillReading } from '@lar-factory/shared';
import type { Item, ListGroup } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { SidebarNavigationItem } from '@lar-factory/ui/design-system/SidebarNavigationItem';
import { SidebarNavigationGroup, SidebarPane } from '@lar-factory/ui/design-system/SidebarPane';
import { useAddItemStore } from '../add-item/add-item-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, repoTone } from '../items/item-parts.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';
import { useScopeStore } from '../board/scope-store.ts';
import { matchesSearch } from './list-search.ts';
import { EXPANDED, ExpandButton, useExpand, dialogPreference } from '../expand-dialog/expand-dialog.tsx';
import { kind } from '../buttons/button-kinds.tsx';

const SORTS = {
  updated: { label: 'Recently updated', compare: (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt) },
  oldest: { label: 'Oldest', compare: (a: Item, b: Item) => a.updatedAt.localeCompare(b.updatedAt) },
  title: { label: 'Title', compare: (a: Item, b: Item) => a.title.localeCompare(b.title) },
  priority: { label: 'Backlog priority', compare: (a: Item, b: Item) => (a.sourceOrder ?? Infinity) - (b.sourceOrder ?? Infinity) },
} as const;
type Sort = keyof typeof SORTS;
const isSort = (value: string): value is Sort => value in SORTS;

/** A group in the left pane; one with no `count`, as a repository still reading, shows none. */
function GroupItem({ label, count, icon, active, onPick }: { label: string; count?: number; icon: React.ReactNode; active: boolean; onPick: () => void }) {
  return (
    <SidebarNavigationItem active={active} onClick={onPick}>
      {icon}
      <span className="name min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && <span className="count text-xs tabular-nums text-base-700">{count}</span>}
    </SidebarNavigationItem>
  );
}

function RepoAvatar({ repo, name }: { repo: string; name: string }) {
  const repos = useBoardStore((state) => state.data.repos);
  return (
    <span className={`${repoTone(repo, repos)} grid size-5 shrink-0 place-items-center rounded-md bg-[var(--k,var(--color-base-600))] text-[10px] font-bold text-white`} aria-hidden="true">
      {name[0]!.toUpperCase()}
    </span>
  );
}

function ItemRow({ item, now, showRepo, onOpen }: { item: Item; now: number; showRepo: boolean; onOpen: () => void }) {
  const repos = useBoardStore((state) => state.data.repos);
  return (
    <button type="button" onClick={onOpen} data-item={item.id} title={item.title}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-base-200/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
      <ItemStatusGlyph item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-[18px] text-base-content">{item.title}</span>
        <AzureFields azure={item.azure} />
        <span className="block truncate text-xs leading-4 tabular-nums text-base-700">
          {showRepo && `${repoName(repoKey(item), repos)} · `}{ref(item)} · {shortAgo(item.updatedAt, now)}
        </span>
      </span>
    </button>
  );
}

function SortMenu({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button {...kind('other')} className="sort ml-auto" rightIcon={<ChevronDown />}>{SORTS[sort].label}</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => isSort(value) && onSort(value)}>
          {Object.entries(SORTS).map(([value, { label }]) => <DropdownMenu.RadioItem key={value} value={value}>{label}</DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

/**
 * When the item dialog closes and the copied Modal had nowhere to return focus, as when its item left List while it
 * was open and took its row along, focus goes to the List's search field.
 */
function useFocusSearchWhenOpenerGoes(searchField: React.RefObject<HTMLInputElement | null>) {
  const itemOpen = useItemDialogStore((state) => state.itemId !== null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !itemOpen;
    wasOpen.current = itemOpen;
    if (!closed) return;
    // The copied Modal returns focus on the next task when the element that had it is still on the page.
    const timer = setTimeout(() => { if (document.activeElement === document.body) searchField.current?.focus(); });
    return () => clearTimeout(timer);
  }, [itemOpen, searchField]);
}

function ListModal({ onClose }: { onClose: () => void }) {
  const childOpen = useItemDialogStore((state) => state.itemId !== null);
  const addOpen = useAddItemStore((state) => state.open);
  const [expanded, toggleExpanded] = useExpand(childOpen || addOpen, dialogPreference('openList'));
  const data = useBoardStore((state) => state.data);
  const now = useBoardStore((state) => state.now);
  const { scope, setScope } = useScopeStore();
  const [query, setQuery] = useState('');
  // The chosen group's repository, or `null` for All repositories.
  const [pick, setPick] = useState<string | null>(scope);
  const [sort, setSort] = useState<Sort | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  useFocusSearchWhenOpenerGoes(searchField);
  const q = query.trim().toLowerCase();
  // In boardSections' order, which counts items before the search so the rows stay put while typing.
  const groups = boardSections(data, now).listGroups.map((group): ListGroup => ({ ...group, items: group.items.filter((i) => matchesSearch(i, q)) }));
  // A picked group that's gone shows All repositories.
  const picked = groups.find((group) => group.repo === pick);
  const active = picked?.repo ?? null;
  const unsorted = picked ? [...picked.items] : groups.flatMap((group) => group.items);
  const effectiveSort = sort ?? (unsorted.some((item) => item.azure) ? 'priority' : 'updated');
  const items = unsorted.sort(SORTS[effectiveSort].compare);
  const scoped = picked !== undefined && scope === picked.repo;
  // A repository whose items haven't landed yet isn't empty, so it shows no count.
  const reading = picked !== undefined && stillReading(data, picked.repo);
  const groupItem = ({ repo, name, items: hits }: ListGroup, icon: React.ReactNode) => (
    <GroupItem key={repo} label={name} count={stillReading(data, repo) ? undefined : hits.length} icon={icon} active={active === repo} onPick={() => setPick(repo)} />
  );
  return (
    <Modal onClose={onClose}>
      <Modal.Content data-list-modal data-expanded={expanded} style={expanded ? EXPANDED : undefined} headerActions={<ExpandButton expanded={expanded} toggle={toggleExpanded} />} title="List" focusFirstField
        sidebar={
          <SidebarPane label="Repositories">
            <GroupItem label="All repositories" count={groups.reduce((n, group) => n + group.items.length, 0)} icon={<Inbox />} active={active === null} onPick={() => setPick(null)} />
            <SidebarNavigationGroup label="Repositories">
              {groups.map((group) => groupItem(group, <RepoAvatar repo={group.repo} name={group.name} />))}
            </SidebarNavigationGroup>
          </SidebarPane>
        }>
        <div className="flex shrink-0 flex-col gap-2 px-5 sm:px-6">
          <div className="flex items-center gap-2">
            <Input ref={searchField} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search List" aria-label="Search List items" />
            <Button {...kind('main')} leftIcon={<SquarePen />} className="add-item shrink-0" onClick={() => useAddItemStore.getState().setOpen(true)}>Add item</Button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-base-content">{picked ? picked.name : 'All repositories'}</span>
            {!reading && <Badge>{items.length}</Badge>}
            {picked && (
              <Button {...kind('other')} data-toggle className="scope-board" aria-pressed={scoped} selected={scoped} onClick={() => setScope(scoped ? null : picked.repo)}>
                {scoped ? 'Board scoped' : 'Scope board'}
              </Button>
            )}
            <SortMenu sort={effectiveSort} onSort={setSort} />
          </div>
        </div>
        <Modal.Body>
          {items.map((item) => <ItemRow key={item.id} item={item} now={now} showRepo={!picked} onOpen={() => useItemDialogStore.getState().open(item.id)} />)}
          {!items.length && <p className="empty m-0 p-4 text-sm text-base-700">{q ? 'Nothing here matches.' : reading ? `Reading ${picked!.name}…` : 'Nothing in List.'}</p>}
        </Modal.Body>
      </Modal.Content>
    </Modal>
  );
}

/** "List <count>", the count being the items in List; it opens the List modal. */
export function ListButton() {
  const count = useBoardStore((state) => boardSections(state.data, state.now).list.length);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...kind('control')} className="list-button px-2" leftIcon={<Inbox />} title="List" onClick={() => setOpen(true)}>
        <span className="@max-[70rem]:sr-only">List</span><Badge>{count}</Badge>
      </Button>
      {open && <ListModal onClose={() => setOpen(false)} />}
    </>
  );
}
