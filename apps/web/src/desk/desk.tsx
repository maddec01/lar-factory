// Your desk: the items awaiting your action, including shaping and concept questions, as small cards in one row that
// scrolls sideways under the page's padding to the window's edges. A card opens the item dialog. Every card has the
// same four rows at the same heights, so they line up across cards: source, repository, kind and age, in a stage
// row's order; the title; the status and next step; and the card's action in the right corner, with Open thread as an
// icon beside it. Scope, Kind and Labels narrow the cards. An empty desk is one small line, which while the board is
// disconnected only speaks for the last read, during a first read that may still add items is the loader, and says so
// when Scope, Kind and Labels hide every card.

import { deskItems, needsAnswer, openQuestionThread, HINTS, itemPr, itemName, readingScope } from '@lar-factory/shared';
import type { BoardData, Item, MergeState } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useScopeStore, useShownScope } from '../board/scope-store.ts';
import { rowFilter } from '../filters/item-filters.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { Age, AzureFields, ItemTitle, useActivityUnavailable } from '../items/item-parts.tsx';
import { KeepClicks } from '../items/keep-clicks.tsx';
import { Loader } from '../loading/loader.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { PrLink } from '../items/pr-link.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';
import { RowKind, RowSource } from '../line/row-identity.tsx';
import { ROW_OPENS } from '../line/stage-track.tsx';

const MERGE_COLOR: Record<MergeState, string> = { 'can merge': 'var(--st-done)', checking: 'var(--warning)', blocked: 'var(--muted-foreground)', conflicts: 'var(--error)' };

/**
 * The line beside the card's action: nothing when that action answers the question, else the merge state and checks of the PR Open PR opens, or the status's hint. The checks
 * leave out a zero count other than passed.
 */
function NextStep({ item }: { item: Item }) {
  if (needsAnswer(item)) return null;
  const pipeline = itemPr(item)?.pipeline;
  if (pipeline) {
    const { checks, mergeState } = pipeline;
    const counts = checks
      ? [`${checks.passed} passed`, checks.running && `${checks.running} running`, checks.failed && `${checks.failed} failed`].filter(Boolean).join(' · ')
      : 'no checks';
    return (
      <>
        <span className="size-2 shrink-0 rounded-full" style={{ background: MERGE_COLOR[mergeState] }} />
        <span className="shrink-0 font-medium text-(--foreground)">{mergeState}</span><span className="truncate" title={`${mergeState} · ${counts}`}> · {counts}</span>
      </>
    );
  }
  return <span className="truncate" title={HINTS[item.status]}>{HINTS[item.status]}</span>;
}

/** The card's action, and Open thread as a square icon in the right corner unless it is the action. */
function Actions({ item, data }: { item: Item; data: BoardData }) {
  return (
    // A click beside the buttons opens the item dialog, as anywhere else on the card.
    <KeepClicks className="desk-actions row-action flex h-8 shrink-0 items-center justify-end gap-1.5" passEmpty>
      {needsAnswer(item)
        ? <OpenThread item={item} data={data} threadId={openQuestionThread(item)?.id} label="Answer in T3" />
        : <><PrLink item={item} label="Open PR" /><OpenThread item={item} data={data} iconOnly /></>}
    </KeepClicks>
  );
}

function DeskCard({ item, data }: { item: Item; data: BoardData }) {
  const picked = useItemDialogStore((state) => state.itemId === item.id);
  // The card takes the click; its summary is a button too, so the keyboard can open the dialog.
  return (
    <div onClick={() => useItemDialogStore.getState().open(item.id)} data-item={item.id}
      className={`desk-card relative grid w-88 shrink-0 cursor-pointer content-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-(--card) py-3 pl-4 pr-3 shadow-[inset_3px_0_0_var(--warning)] hover:bg-(--accent) ${picked ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--background)' : ''}`}>
      <button type="button" className={`grid min-w-0 gap-2 rounded text-left ${ROW_OPENS}`}>
        <span className="desk-meta flex h-6 min-w-0 items-center gap-2 text-[11px]">
          <RowSource item={item} />
          <RowKind item={item} />
          <span className="ml-auto shrink-0 text-(--muted-foreground)"><Age at={item.updatedAt} /></span>
        </span>
        <span className="desk-title h-5 truncate text-[13px]/5 font-medium" title={`${itemName(item)}`}><ItemTitle item={item} /></span>
        <AzureFields azure={item.azure} />
      </button>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px]"><ItemStatusGlyph item={item} className="size-3" /><span className="font-semibold text-(--warning-foreground)">{item.status}</span></span>
        <span className="desk-next flex h-5 min-w-0 flex-1 items-center gap-1.5 text-[11px] text-(--muted-foreground) tabular-nums"><NextStep item={item} /></span>
      </span>
      <Actions item={item} data={data} />
    </div>
  );
}

/** `inScope` are the items in the main area's scope. */
export function Desk({ items: inScope }: { items: Item[] }) {
  const data = useBoardStore((state) => state.data);
  const clientError = useBoardStore((state) => state.clientError);
  const unavailable = useActivityUnavailable();
  const filters = useScopeStore((state) => state.filters);
  const items = deskItems({ ...data, items: inScope }, unavailable).filter(rowFilter(filters, data.repos));
  const scope = useShownScope();
  if (!items.length) return (
    <section className="desk flex shrink-0 items-baseline gap-2 text-xs text-(--muted-foreground)" aria-labelledby="desk-h">
      <h2 id="desk-h" className="m-0 text-[13px] font-medium text-(--foreground)">Your desk</h2>
      <p className="m-0">{clientError ? 'Nothing waited on you at the last read.' : readingScope(data, scope ?? undefined) ? <Loader label="Loading Projects…" /> : deskItems(data, unavailable).length ? 'Nothing on your desk matches the filters.' : 'Nothing waits on you.'}</p>
    </section>
  );
  return (
    <section className="desk grid shrink-0 gap-2" aria-labelledby="desk-h">
      <h2 id="desk-h" className="m-0 text-[13px] font-medium">Your desk <span className="text-(--muted-foreground)">{items.length}</span></h2>
      <div className="-mx-6 flex items-start gap-3 overflow-x-auto px-6 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((i) => <DeskCard key={i.id} item={i} data={data} />)}</div>
    </section>
  );
}
