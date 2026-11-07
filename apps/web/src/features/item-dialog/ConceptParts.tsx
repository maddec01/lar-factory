// What a concept's details add about its parts: its own cost beside its total on the board, and its parts on the board,
// each with its status, cost and Open thread, and what its refinement and delivery still need, in words. Parts that
// retention took off the board aren't counted or listed.

import { UNREADABLE, itemTotal, plural } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { BoardNote, ConceptPart, ConceptPartList, DetailsSection, ItemNote } from '@lar-works/design-system';

import {
    AgentWork,
    INCOMPLETE_TOTAL,
    ItemTitle,
    usageUnreadable,
    useShownStatus,
    OpenThread,
    SourceIcon,
    ItemStatusGlyph,
} from '@/features/items';
import { isDone, partsOf } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';

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
                <BoardNote data-total-incomplete>{INCOMPLETE_TOTAL}</BoardNote>
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
        <ConceptPart
            id={item.id}
            title={item.title}
            onOpen={() => openPart(item.id)}
            source={<SourceIcon item={item} />}
            glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} />}
            name={<ItemTitle item={item} />}
            state={complete ? 'Complete' : shown.word}
        >
            {usageUnreadable(item) ? <ItemNote>{UNREADABLE}</ItemNote> : <AgentWork item={item} />}
            {hasThread && <OpenThread item={item} data={data} />}
        </ConceptPart>
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
        <DetailsSection heading="Parts" data-concept-parts>
            <ConceptPartList>
                {parts.map((part) => (
                    <PartRow key={part.item.id} item={part.item} data={data} openPart={openPart} />
                ))}
            </ConceptPartList>
        </DetailsSection>
    );
}
