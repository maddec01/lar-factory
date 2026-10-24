// Your desk: the items only you can move, Needs you, Verify and Ready to merge, as cards in one row that scrolls
// sideways under the page's padding to the window's edges. A card opens the item dialog.

import { HINTS, platformOf, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle, StepTrack } from '../items/item-parts.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';

function DeskCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  return (
    <button type="button" onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id}
      className={`desk-card grid w-70 shrink-0 gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 text-left shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : ''}`}>
      <span className="flex items-center gap-2 text-xs">
        <StatusGlyph status={item.status} /><span className="font-semibold text-(--warning-foreground)">{item.status}</span>
        <span className="truncate text-(--muted-foreground)">· {platformOf(item, data.repos)} · {shortAgo(item.updatedAt, now)}</span>
      </span>
      <span className="line-clamp-2 font-medium leading-snug"><ItemTitle item={item} /></span>
      <span className="text-xs text-(--muted-foreground)">{HINTS[item.status]}</span>
      <StepTrack status={item.status} />
    </button>
  );
}

/** `items` are the desk's items in the main area's scope. */
export function Desk({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  return (
    <section className="desk grid gap-3" aria-labelledby="desk-h">
      <h2 id="desk-h" className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{items.length}</span></h2>
      {items.length
        ? <div className="-mx-6 flex gap-3 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} />)}</div>
        : <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Desk clear. The line runs without you.</p>}
    </section>
  );
}
