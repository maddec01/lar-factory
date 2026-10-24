// The line's Queue: Queued items, in order, as numbered rows that open the item dialog, each started by hand. The
// header shows the build slots against their limit, which the Queue shows but doesn't enforce, and Start next. An
// item a dossier shows as a part, such as a concept's decision, shows there, not here; a dossier's parent stays.
// Reordering and Auto-start aren't built yet.

import type { MouseEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { platformOf, shortAgo, slug, workMessage } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { BUILD_LIMIT, buildsInSlots } from '../items/build-slots.ts';
import { ItemTitle } from '../items/item-parts.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartControl, StartMessage } from '../items/start-control.tsx';
import { STATUS_COLOR, StatusGlyph } from '../items/status-glyph.tsx';
import { dossiersOf, partsInDossiers } from './dossier-parts.ts';

const DRAFT_HINT = 'This draft needs an issue before it can start. Convert it to an issue in a repo.';

/** Keeps a click on a row's controls from opening the item dialog. */
const stop = (e: MouseEvent) => e.stopPropagation();

/** Whether Start can run on the item: an issue, with no item thread running or waiting on you. */
const canStart = (item: Item) => Boolean(workMessage(item)) && !hasLiveThread(item);

/** A row's action: Start refining, Open thread while the item has a live thread, or why a draft can't start. */
function RowAction({ item, data, first }: { item: Item; data: BoardData; first: boolean }) {
  if (!workMessage(item)) return <span className="queue-hint shrink-0 text-[11px] text-(--muted-foreground)" title={DRAFT_HINT}>Needs an issue to start</span>;
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} size="xs" />;
  return <StartControl item={item} data={data} label="Start refining" variant={first ? 'default' : 'outline'} />;
}

/** `first` marks the row Start next starts, whose Start is the primary one. */
function Row({ item, n, data, now, first, waits }: { item: Item; n: number; data: BoardData; now: number; first: boolean; waits: boolean }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  const platform = platformOf(item, data.repos);
  const labels = item.labels.filter((l) => !l.includes(':'));
  return (
    <li data-item={item.id} onClick={() => useItemDialogStore.getState().open(item.id)}
      className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--border) px-3 py-2 last:border-b-0 hover:bg-(--accent) ${picked ? 'bg-(--accent) ring-2 ring-inset ring-(--primary)' : ''}`}>
      <button type="button" className="drag shrink-0 text-(--muted-foreground)" disabled title="Reordering isn't built yet" aria-label={`Move ${item.title}`}>
        <GripVertical className="size-3.5" />
      </button>
      <span className="queue-n w-4 shrink-0 text-right text-[11px] font-medium tabular-nums text-(--muted-foreground)">{n + 1}</span>
      <span className={`plat-${slug(platform)} size-1.5 shrink-0 rounded-full bg-[var(--k,var(--muted-foreground))]`} />
      <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="queue-title truncate text-[13px]"><ItemTitle item={item} /></span>
        <span className="queue-meta truncate text-[11px] text-(--muted-foreground)">{platform} · queued {shortAgo(item.updatedAt, now)}{labels.length > 0 && ` · ${labels.join(', ')}`}</span>
      </button>
      {waits && <span className="shrink-0 text-[11px] text-(--muted-foreground)">next when a build slot frees</span>}
      <span className="shrink-0" onClick={stop}><RowAction item={item} data={data} first={first} /></span>
      <div className="basis-full empty:hidden" onClick={stop}><StartMessage item={item} /></div>
    </li>
  );
}

/** Builds in progress against the limit, one bar per slot, more when they're over it. */
function BuildSlots({ building }: { building: number }) {
  return (
    <span className="build-slots inline-flex items-center gap-1.5 tabular-nums" title="Builds in flight against the limit">
      <span className="inline-flex gap-[3px]">
        {Array.from({ length: Math.max(BUILD_LIMIT, building) }, (_, n) => (
          <span key={n} className="slot h-1.5 w-3 rounded-full" style={{ background: n < building ? STATUS_COLOR['In progress'] : 'var(--border)' }} />
        ))}
      </span>
      {building}/{BUILD_LIMIT} building
    </span>
  );
}

function Header({ items, building, next, data }: { items: Item[]; building: number; next: Item | undefined; data: BoardData }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--border) px-3 py-2.5">
      <StatusGlyph status="Queued" />
      <span id="queue-h" className="text-[13px] font-medium">Queue <span className="font-normal text-(--muted-foreground) tabular-nums">{items.length}</span></span>
      <span className="text-[11px] text-(--muted-foreground)">Starting one opens a refining thread; once refined it moves to Ready.</span>
      <span className="ml-auto flex items-center gap-2 text-[11px] text-(--muted-foreground)">
        <BuildSlots building={building} />
        <button type="button" role="switch" aria-checked={false} disabled title="Auto-start isn't built yet: it will start the next item whenever a build slot frees"
          className="inline-flex items-center gap-1.5 rounded-full border border-(--border) px-2 py-0.5">
          <span className="relative h-3 w-5 rounded-full bg-(--input)"><span className="absolute left-0.5 top-0.5 size-2 rounded-full bg-(--card)" /></span>Auto-start
        </button>
        {next && <StartControl item={next} data={data} label="Start next" />}
      </span>
    </header>
  );
}

/** `items` are the items in the main area's scope; the build slots count the whole factory's. */
export function Queue({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  const parts = partsInDossiers(dossiersOf(items, data.items));
  const queued = items.filter((i) => i.status === 'Queued' && !parts.has(i.id));
  const building = buildsInSlots(data.items).length;
  const next = queued.find(canStart);
  return (
    <section className="queue overflow-hidden rounded-xl border border-(--border) bg-(--card)" aria-labelledby="queue-h">
      <Header items={queued} building={building} next={next} data={data} />
      {queued.length ? (
        <ol className="m-0 grid list-none p-0">
          {/* The row Start next starts is the one that waits for a slot. */}
          {queued.map((i, n) => <Row key={i.id} item={i} n={n} data={data} now={now} first={i === next} waits={i === next && building >= BUILD_LIMIT} />)}
        </ol>
      ) : <p className="m-0 p-6 text-center text-(--muted-foreground)">Queue empty. Queue items from List in the sidebar.</p>}
    </section>
  );
}
