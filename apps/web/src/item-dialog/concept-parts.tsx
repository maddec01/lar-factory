// What a concept's details add about its parts: its own cost beside its total on the board, and its parts on the board,
// each with its status, cost and Open thread. Parts that retention took off the board aren't counted or listed.

import { UNREADABLE, itemTotal } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { AgentWork, ItemTitle, usageUnreadable, useShownStatus } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { StatusGlyph } from '../items/status-glyph.tsx';
import { isDone, partsOf } from '../line/dossier-parts.ts';

/** The concept's own figures and its total, each labelled; a total that isn't usable leaves the own figures alone. */
export function ConceptWork({ item }: { item: Item }) {
  const total = itemTotal(item, useBoardStore((state) => state.data.items));
  return <>
    <AgentWork item={item} label="Own cost" />
    {total && total !== 'unavailable' && <AgentWork item={item} stats={total} label="Total on the board" />}
  </>;
}

function PartRow({ item, data, openPart }: { item: Item; data: BoardData; openPart: (itemId: string) => void }) {
  const shown = useShownStatus(item);
  const complete = isDone(item);
  const hasThread = item.threads === 'unavailable' || Boolean(item.threads?.length);
  return (
    <li data-concept-part={item.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 hover:bg-(--soft)">
      <button type="button" onClick={() => openPart(item.id)} title={item.title} className="flex min-w-0 flex-1 basis-56 items-start gap-1.5 text-left text-[13px] hover:underline">
        <SourceIcon item={item} />
        <span className="mt-0.5 inline-flex"><StatusGlyph status={complete ? 'Done' : shown.glyph} className="size-3.5" /></span>
        <span className="line-clamp-2"><ItemTitle item={item} /></span>
      </button>
      <span className="shrink-0 text-xs text-(--muted-foreground)">{complete ? 'Complete' : shown.word}</span>
      {usageUnreadable(item) ? <span className="text-xs text-(--muted-foreground)">{UNREADABLE}</span> : <AgentWork item={item} />}
      {hasThread && <OpenThread item={item} data={data} />}
    </li>
  );
}

export function ConceptParts({ item, data, openPart }: { item: Item; data: BoardData; openPart: (itemId: string) => void }) {
  const parts = partsOf(item, data.items);
  if (!parts.length) return null;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-concept-parts>
      <h2 className="m-0 text-[13px] font-medium">Parts</h2>
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
        {parts.map((part) => <PartRow key={part.item.id} item={part.item} data={data} openPart={openPart} />)}
      </ul>
    </section>
  );
}
