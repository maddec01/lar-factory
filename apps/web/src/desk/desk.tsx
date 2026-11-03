// Your desk: the items awaiting your action, including shaping and concept questions, as cards in one row that scrolls
// sideways under the page's padding to the window's edges. A card opens the item dialog. Every card has the same five
// rows at the same heights, so they line up across cards: status, repository and age; the title; the next step; the
// step track; and the actions, the card's action on the left and Open thread as an icon in the right corner. An empty
// desk is one small line.

import { decisionMethodName, needsAnswer, openQuestionThread, HINTS, itemPr, itemName, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { BoardData, Item, MergeState } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { AzureFields, ItemTitle, StepTrack } from '../items/item-parts.tsx';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { SourceIcon } from '../items/source-icon.tsx';

const MERGE_COLOR: Record<MergeState, string> = { 'can merge': 'var(--st-done)', checking: 'var(--warning)', blocked: 'var(--muted-foreground)', conflicts: 'var(--error)' };

/**
 * The one line under the title: the merge state and checks of the PR Open PR opens, or the status's hint. The checks
 * leave out a zero count other than passed.
 */
function NextStep({ item }: { item: Item }) {
  if (needsAnswer(item)) return <span className="truncate">Answer in T3</span>;
  const pipeline = itemPr(item)?.pipeline;
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
  return <span className="truncate">{HINTS[item.status]}</span>;
}

/** One row: the card's action on the left, and Open thread as a square icon in the right corner unless it is the action. */
function Actions({ item, data }: { item: Item; data: BoardData }) {
  return (
    // A click beside the buttons opens the item dialog, as anywhere else on the card.
    <KeepClicks className="desk-actions flex h-7 min-w-0 items-center justify-start gap-2" passEmpty>
      {needsAnswer(item)
        ? <OpenThread item={item} data={data} threadId={openQuestionThread(item)?.id} label="Answer in T3" />
        : <><PrLink item={item} label="Open PR" /><span className="ml-auto flex"><OpenThread item={item} data={data} iconOnly /></span></>}
    </KeepClicks>
  );
}

/** The status's neighbours on one line, which may truncate, so its tooltip keeps them whole. */
function DeskFacts({ facts }: { facts: (string | null)[] }) {
  const text = facts.filter(Boolean).join(' · ');
  return <span className="truncate text-(--muted-foreground)" title={text}>· {text}</span>;
}

function DeskCard({ item, data, now }: { item: Item; data: BoardData; now: number }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  // The card takes the click; its summary is a button too, so the keyboard can open the dialog.
  return (
    <div onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id}
      className={`desk-card relative grid w-70 shrink-0 cursor-pointer content-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) p-3.5 shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : ''}`}>
      <SourceIcon item={item} corner />
      <button type="button" className="grid min-w-0 gap-2 text-left">
        <span className="desk-meta flex h-4 min-w-0 items-center gap-2 pr-4 text-xs">
          <StatusGlyph status={item.status} /><span className="shrink-0 font-semibold text-(--warning-foreground)">{item.status}</span>
          <DeskFacts facts={[decisionMethodName(item), repoName(repoKey(item), data.repos), shortAgo(item.updatedAt, now)]} />
        </span>
        {/* Two lines tall whatever the title's length, so the rows under it start at the same height on every card. */}
        <span className="desk-title line-clamp-2 h-10 text-sm/5 font-medium" title={`${itemName(item)}`}><ItemTitle item={item} /></span>
        <AzureFields azure={item.azure} />
        <span className="desk-next flex h-4 min-w-0 items-center gap-1.5 text-xs text-(--muted-foreground) tabular-nums"><NextStep item={item} /></span>
        <span className="pt-1"><StepTrack status={item.status} /></span>
      </button>
      <Actions item={item} data={data} />
    </div>
  );
}

/** `items` are the desk's items in the main area's scope. */
export function Desk({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  if (!items.length) return (
    <section className="desk flex items-baseline gap-2 text-xs text-(--muted-foreground)" aria-labelledby="desk-h">
      <h2 id="desk-h" className="m-0 text-[13px] font-medium text-(--foreground)">Your desk</h2>
      <p className="m-0">Nothing waits on you.</p>
    </section>
  );
  return (
    <section className="desk grid gap-3" aria-labelledby="desk-h">
      <h2 id="desk-h" className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{items.length}</span></h2>
      <div className="-mx-6 flex items-start gap-3 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((i) => <DeskCard key={i.id} item={i} data={data} now={now} />)}</div>
    </section>
  );
}
