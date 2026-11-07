// What a concept's details add about its parts: its own cost beside its total on the board, and its parts on the board,
// each with its status, cost and Open thread, and what its refinement and delivery still need, in words. Parts that
// retention took off the board aren't counted or listed.

import { UNREADABLE, itemTotal, plural } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { useBoardStore } from '../board/board-store.ts';
import { AgentWork, INCOMPLETE_TOTAL, ItemTitle, usageUnreadable, useShownStatus } from '../items/item-parts.tsx';
import { OpenThread } from '../items/open-thread.tsx';
import { SourceIcon } from '../items/source-icon.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';
import { isDone, partsOf } from '../line/dossier-parts.ts';

const WORK_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UNFINISHED_PART = new RegExp(`^Its (.+) (${WORK_ID}) isn't (?:settled|Done)\\.$`);
const UNMET_DEPENDENCY = new RegExp(`^Its Dependency ${WORK_ID} on (.+) isn't met\\.$`);

/**
 * What a concept's refinement or delivery still needs, in words for a person: unfinished parts counted by kind with
 * their names in `names`, and every other reason as written, with no work IDs.
 */
function readableReasons(reasons: readonly string[], items: readonly Item[]): { text: string; names: string } {
    const unfinished = new Map<string, string[]>();
    const others: string[] = [];
    for (const reason of reasons) {
        const part = UNFINISHED_PART.exec(reason);
        if (part) unfinished.set(part[1]!, [...(unfinished.get(part[1]!) ?? []), part[2]!]);
        else
            others.push(
                reason
                    .replace(UNMET_DEPENDENCY, "Dependency on $1 isn't met.")
                    .replace(new RegExp(` ?${WORK_ID}`, 'g'), ''),
            );
    }
    const counts = [...unfinished].map(
        ([kind, ids]) => `${plural(ids.length, kind)} ${kind === 'decision' ? 'unsettled' : 'remaining'}.`,
    );
    const names = [...unfinished.values()].flat().flatMap((id) => items.find((item) => item.id === id)?.title ?? []);
    return { text: [...counts, ...others].join(' '), names: names.join(', ') };
}

/** A concept's Refinement or Delivery: Complete, or what it still needs, naming unfinished parts in its tooltip. */
export function ConceptState({ state }: { state: { complete: boolean; reasons: string[] } }) {
    const { text, names } = readableReasons(
        state.reasons,
        useBoardStore((board) => board.data.items),
    );
    return <span title={names || undefined}>{state.complete ? 'Complete' : text}</span>;
}

/** The concept's own figures and its total, each labelled; a total with no figures says it is incomplete, beside the own figures. */
export function ConceptWork({ item }: { item: Item }) {
    const total = itemTotal(
        item,
        useBoardStore((state) => state.data.items),
    );
    return (
        <>
            <AgentWork item={item} label="Own cost" />
            {total === 'unavailable' ? (
                <p data-total-incomplete className="m-0 text-xs text-(--muted-foreground)">
                    {INCOMPLETE_TOTAL}
                </p>
            ) : (
                total && <AgentWork item={item} stats={total} label="Total on the board" />
            )}
        </>
    );
}

function PartRow({ item, data, openPart }: { item: Item; data: BoardData; openPart: (itemId: string) => void }) {
    const shown = useShownStatus(item);
    const complete = isDone(item);
    const hasThread = item.threads === 'unavailable' || Boolean(item.threads?.length);
    return (
        <li
            data-concept-part={item.id}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 hover:bg-(--soft)"
        >
            <button
                type="button"
                onClick={() => openPart(item.id)}
                title={item.title}
                className="flex min-w-0 flex-1 basis-56 items-start gap-1.5 text-left text-[13px] hover:underline"
            >
                <SourceIcon item={item} />
                <span className="mt-0.5 inline-flex">
                    <ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} className="size-3.5" />
                </span>
                <span className="line-clamp-2">
                    <ItemTitle item={item} />
                </span>
            </button>
            <span className="shrink-0 text-xs text-(--muted-foreground)">{complete ? 'Complete' : shown.word}</span>
            {usageUnreadable(item) ? (
                <span className="text-xs text-(--muted-foreground)">{UNREADABLE}</span>
            ) : (
                <AgentWork item={item} />
            )}
            {hasThread && <OpenThread item={item} data={data} />}
        </li>
    );
}

export function ConceptParts({
    item,
    data,
    openPart,
}: {
    item: Item;
    data: BoardData;
    openPart: (itemId: string) => void;
}) {
    const parts = partsOf(item, data.items);
    if (!parts.length) return null;
    return (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-concept-parts>
            <h2 className="m-0 text-[13px] font-medium">Parts</h2>
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
                {parts.map((part) => (
                    <PartRow key={part.item.id} item={part.item} data={data} openPart={openPart} />
                ))}
            </ul>
        </section>
    );
}
