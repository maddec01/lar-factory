// What a concept's details add about its parts: its own cost beside its total on the board, and every part on the board,
// each with its status, usage under it and Open thread beside it, and what its refinement and delivery still need, in
// words. Parts off the board aren't listed; the count above says how many and why.

import { UNREADABLE, itemTotal, plural } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import {
    AgentWork,
    hasFigures,
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
import { DetailFact, DetailsSection, PartName, PartRow, PartsList } from '@/ui/board';

const WORK_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UNFINISHED_PART = new RegExp(`^Its (.+) (${WORK_ID}) isn’t (?:settled|Done)\\.$`);
const UNMET_DEPENDENCY = new RegExp(`^Its Dependency ${WORK_ID} on (.+) isn’t met\\.$`);

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
                    .replace(UNMET_DEPENDENCY, 'Dependency on $1 isn’t met.')
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

/** The concept’s labelled total with its parts; a total with no usable figures explains why it is incomplete. */
export function ConceptWork({ item }: { item: Item }) {
    const total = itemTotal(
        item,
        useBoardStore((state) => state.data.items),
    );

    if (!total || (total !== 'unavailable' && !hasFigures(total))) return null;

    return (
        <DetailFact label="With parts" data-concept-work>
            {total === 'unavailable' ? (
                <Text variant="caption" tone="muted" data-total-incomplete>
                    {INCOMPLETE_TOTAL}
                </Text>
            ) : (
                total && <AgentWork item={item} stats={total} />
            )}
        </DetailFact>
    );
}

function ConceptPartRow({ item, data, openPart }: { item: Item; data: BoardData; openPart: (itemId: string) => void }) {
    const shown = useShownStatus(item);
    const complete = isDone(item);
    const hasThread = item.threads === 'unavailable' || Boolean(item.threads?.length);
    const usage = usageUnreadable(item) ? UNREADABLE : <AgentWork item={item} inline />;

    return (
        <PartRow
            id={item.id}
            picked={false}
            title={item.title}
            onOpen={() => openPart(item.id)}
            name={
                <PartName
                    source={<SourceIcon item={item} />}
                    glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} />}
                >
                    <ItemTitle item={item} />
                </PartName>
            }
            meta={complete ? 'Complete' : shown.word}
            usage={usage}
            action={hasThread && <OpenThread item={item} data={data} part />}
        />
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
        // The progress above names the parts and counts them, so the list needs no heading of its own.
        <DetailsSection data-concept-parts>
            <PartsList>
                {parts.map((part) => (
                    <ConceptPartRow key={part.item.id} item={part.item} data={data} openPart={openPart} />
                ))}
            </PartsList>
        </DetailsSection>
    );
}
