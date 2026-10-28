// Your desk: the items only you can move, Ready, Needs you, Verify and Ready to merge, as cards in one row that scrolls
// sideways under the page's padding to the window's edges. A card opens the item dialog. Every card has the same five
// rows at the same heights, so they line up across cards: status, repository and age; the title; the next step; the
// step track; and the actions, the card's action on the left and Open thread as an icon in the right corner. Only a
// Ready card's start message or Start after error, under its actions, makes one card taller than the rest.

import { HINTS, carriesTwoStatuses, itemPr, openBlockerRefs, ref, repoKey, repoName, shortAgo, startHold } from '@lar-factory/shared';
import type { BoardData, Item, MergeState } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, StepTrack } from '../items/item-parts.tsx';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { StartAfterError, showsStartAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';

/** Whether the card's action is Start build, or Start after in its place: a Ready item no thread works on yet, carrying no other status. */
const startsBuild = (item: Item) => item.status === 'Ready' && !hasLiveThread(item) && !carriesTwoStatuses(item);

/** What a Ready card waits on: the open blockers Start after names, what holds its repository, or nothing. */
function readyStep(item: Item, data: BoardData): string {
  if (!startsBuild(item)) return hasLiveThread(item) ? 'A thread is at work on it' : 'Ready to build';
  if (showsStartAfter(item, data)) return `Waits on ${openBlockerRefs(item, true).join(', ')}`;
  return startHold(data, item.repo) ?? 'Ready to build';
}

/** Whether the card's action is Open PR: a Verify or Ready to merge item. Only that card reads its PR's merge state and checks. */
const readsPr = (item: Item) => item.status === 'Verify' || item.status === 'Ready to merge';

const MERGE_COLOR: Record<MergeState, string> = { 'can merge': 'var(--st-done)', checking: 'var(--warning)', blocked: 'var(--muted-foreground)', conflicts: 'var(--error)' };

/**
 * The one line under the title: the merge state and checks of the PR Open PR opens, what a Ready card waits on, or the
 * status's hint. The checks leave out a zero count other than passed.
 */
function NextStep({ item, data }: { item: Item; data: BoardData }) {
  const pipeline = readsPr(item) ? itemPr(item)?.pipeline : undefined;
  if (pipeline) {
    const { checks, mergeState } = pipeline;
    const counts = checks
      ? [`${checks.passed} passed`, checks.running && `${checks.running} running`, checks.failed && `${checks.failed} failed`].filter(Boolean).join(' · ')
      : 'no checks';
    return (
      <>
        <span className="size-2 shrink-0 rounded-full" style={{ background: MERGE_COLOR[mergeState] }} />
        <span className="shrink-0 font-medium text-(--foreground)">{mergeState}</span><span className="truncate"> · {counts}</span>
      </>
    );
  }
  return <span className="truncate">{item.status === 'Ready' ? readyStep(item, data) : HINTS[item.status]}</span>;
}

/** One row: the card's action on the left, and Open thread as a square icon in the right corner unless it is the action. */
function Actions({ item, data }: { item: Item; data: BoardData }) {
  const action = startsBuild(item) ? <StartBuild item={item} data={data} />
    : readsPr(item) ? <PrLink item={item} label="Open PR" />
    : null;
  return (
    // A click beside the buttons opens the item dialog, as anywhere else on the card.
    <KeepClicks className="desk-actions flex h-7 min-w-0 items-center gap-2" passEmpty>
      {action ?? <OpenThread item={item} data={data} />}
      {action && <span className="ml-auto flex"><OpenThread item={item} data={data} iconOnly /></span>}
    </KeepClicks>
  );
}

function DeskCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  // The card takes the click; its summary is a button too, so the keyboard can open the dialog.
  return (
    <div onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id}
      className={`desk-card grid w-70 shrink-0 cursor-pointer content-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : ''}`}>
      <button type="button" className="grid min-w-0 gap-2 text-left">
        <span className="desk-meta flex h-4 min-w-0 items-center gap-2 text-xs">
          <ItemStatusGlyph item={item} /><span className="shrink-0 font-semibold text-(--warning-foreground)">{item.status}</span>
          <span className="truncate text-(--muted-foreground)">· {repoName(repoKey(item), data.repos)} · {shortAgo(item.updatedAt, now)}</span>
        </span>
        {/* Two lines tall whatever the title's length, so the rows under it start at the same height on every card. */}
        <span className="desk-title line-clamp-2 h-10 text-sm/5 font-medium" title={`${ref(item)} ${item.title}`}><ItemTitle item={item} /></span>
        <AzureFields azure={item.azure} />
        <span className="desk-next flex h-4 min-w-0 items-center gap-1.5 text-xs text-(--muted-foreground) tabular-nums"><NextStep item={item} data={data} /></span>
        <span className="pt-1"><StepTrack status={item.status} /></span>
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
        ? <div className="-mx-6 flex items-start gap-3 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} />)}</div>
        : <p className="m-0 rounded-xl border border-dashed border-(--input) p-6 text-center text-(--muted-foreground)">Desk clear. The line runs without you.</p>}
    </section>
  );
}
