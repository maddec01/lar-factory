// Your desk: the items only you can move, Ready, Needs you, Verify and Ready to merge, as cards in one row that scrolls
// sideways under the page's padding to the window's edges. A card opens the item dialog, and carries the buttons for
// its next action: Open thread on every card, Start build on a Ready one, Open PR on Verify and Ready to merge. A Verify
// card also shows that PR's pipeline: its checks and whether GitHub lets it merge.

import { HINTS, carriesTwoStatuses, itemPr, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item, MergeState } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { ItemTitle, StepTrack } from '../items/item-parts.tsx';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { StartAfterError } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';

/**
 * Open thread, then what the status asks next. A Ready item with a thread at work gets no Start build, so Open thread
 * shows once, and neither does one carrying another status until the user keeps one.
 */
function Actions({ item, data }: { item: Item; data: BoardData }) {
  // StartBuild shows Open thread itself for a live thread, which would put it on the card twice.
  const next = item.status === 'Ready' ? !hasLiveThread(item) && !carriesTwoStatuses(item) && <StartBuild item={item} data={data} />
    : item.status === 'Verify' || item.status === 'Ready to merge' ? <PrLink item={item} label="Open PR" size="xs" />
    : null;
  return (
    // A click beside the buttons opens the item dialog, as anywhere else on the card.
    <KeepClicks className="desk-actions flex min-w-0 flex-wrap gap-2" passEmpty>
      <OpenThread item={item} data={data} size="xs" variant={next ? 'outline' : undefined} />{next}
    </KeepClicks>
  );
}

const MERGE_COLOR: Record<MergeState, string> = { 'can merge': 'var(--st-done)', checking: 'var(--warning)', blocked: 'var(--muted-foreground)', conflicts: 'var(--error)' };

/** The checks of the PR Open PR opens, counted, or no checks, then its merge state; nothing while there is no PR. */
function Pipeline({ item }: { item: Item }) {
  const pipeline = itemPr(item)?.pipeline;
  if (!pipeline) return null;
  const { checks, mergeState } = pipeline;
  return (
    <span className="desk-pipeline grid gap-1 text-xs text-(--muted-foreground) tabular-nums">
      <span>{checks ? `${checks.passed} passed · ${checks.running} running · ${checks.failed} failed` : 'no checks'}</span>
      {/* The merge state gets its own line, so a narrow card never wraps it after a dangling separator. */}
      <span className="inline-flex items-center gap-1.5 font-medium text-(--foreground)">
        <span className="size-2 rounded-full" style={{ background: MERGE_COLOR[mergeState] }} />{mergeState}
      </span>
    </span>
  );
}

function DeskCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  const hint = HINTS[item.status];
  // The card takes the click; its summary is a button too, so the keyboard can open the dialog.
  return (
    <div onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id}
      className={`desk-card grid w-70 shrink-0 cursor-pointer content-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : ''}`}>
      <button type="button" className="grid gap-2.5 text-left">
        <span className="flex items-center gap-2 text-xs">
          <ItemStatusGlyph item={item} /><span className="font-semibold text-(--warning-foreground)">{item.status}</span>
          <span className="truncate text-(--muted-foreground)">· {repoName(repoKey(item), data.repos)} · {shortAgo(item.updatedAt, now)}</span>
        </span>
        <span className="line-clamp-2 font-medium leading-snug"><ItemTitle item={item} /></span>
        {hint && <span className="text-xs text-(--muted-foreground)">{hint}</span>}
        {item.status === 'Verify' && <Pipeline item={item} />}
        <StepTrack status={item.status} />
      </button>
      <Actions item={item} data={data} />
      {item.status === 'Ready' && <KeepClicks className="desk-start cursor-auto empty:hidden"><StartMessage item={item} kind="build" /><StartAfterError item={item} data={data} /></KeepClicks>}
    </div>
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
