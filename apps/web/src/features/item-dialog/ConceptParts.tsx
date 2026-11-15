// What a concept's details add about its parts: its own cost beside its total on the board, and every part on the board,
// each with its status, usage under it and Open thread beside it, and what its refinement and delivery still need, in
// words. Parts off the board aren't listed; the count above says how many and why.

import { UNREADABLE, itemTotal, needsAnswer, plural, retiredPartLabel, shapingOwner } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import {
    conceptBuildWait,
    AgentWork,
    hasFigures,
    ItemTitle,
    RepoCell,
    usageUnreadable,
    useShownStatus,
    OpenThread,
    SourceIcon,
    ItemStatusGlyph,
} from '@/features/items';
import {
    ConceptOpenQuestions,
    ConceptPartsBar,
    isDone,
    partsOf,
    RowKindMark,
    unreadParts,
    unreadPartsText,
} from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    DetailFact,
    PartName,
    PartRow,
    PartsList,
    MainSection,
    SectionHeader,
    WaitWord,
    workHoldReason,
} from '@/ui/board';

const WORK_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UNFINISHED_PART = new RegExp(`^Its (.+) (${WORK_ID}) isn['’]t (?:settled|Done)[.]$`);
const UNMET_DEPENDENCY = new RegExp(`^Its Dependency ${WORK_ID} on (.+) isn['’]t met[.]$`);

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
                workHoldReason(reason)
                    .replace(/^Its build isn['’]t Done[.]$/, 'Builds remain.')
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
export function ConceptState({ state, item }: { state: { complete: boolean; reasons: string[] }; item?: Item }) {
    const items = useBoardStore((board) => board.data.items);
    const builds = item && partsOf(item, items).filter((part) => part.kind === 'build' && !part.item.setAside);
    const otherReasons = state.reasons.filter((reason) => !reason.startsWith('Its build '));

    if (builds?.length)
        return (
            <>
                {builds.filter((part) => isDone(part.item)).length} of {builds.length} builds done
                {otherReasons.length > 0 && (
                    <>
                        {' '}
                        · <ConceptReasons state={{ complete: false, reasons: otherReasons }} />
                    </>
                )}
            </>
        );

    return <ConceptReasons state={state} />;
}

function ConceptReasons({ state }: { state: { complete: boolean; reasons: string[] } }) {
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

    if (!total || total === 'unavailable' || !hasFigures(total)) return null;

    return (
        <DetailFact label="With parts" data-concept-work>
            <AgentWork item={item} stats={total} />
        </DetailFact>
    );
}

function ConceptPartRow({
    item,
    data,
    openPart,
    parentRepo,
}: {
    item: Item;
    data: BoardData;
    openPart: (itemId: string) => void;
    /** The concept's own repository, which a part in the same one doesn't repeat. */
    parentRepo: string | undefined;
}) {
    const shown = useShownStatus(item);
    const complete = isDone(item);
    const hasThread = item.threads === 'unavailable' || Boolean(item.threads?.length || shapingOwner(item, data.items));
    const usage = usageUnreadable(item) ? UNREADABLE : <AgentWork item={item} inline />;

    return (
        <PartRow
            id={item.id}
            picked={false}
            title={item.title}
            onOpen={() => openPart(item.id)}
            name={
                <PartName
                    source={
                        <>
                            <RowKindMark item={item} />
                            <SourceIcon item={item} />
                        </>
                    }
                    glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} />}
                >
                    <ItemTitle item={item} />
                </PartName>
            }
            meta={
                <>
                    {item.repo !== parentRepo && <RepoCell item={item} />}
                    {!complete && (needsAnswer(item) || item.status === 'Needs you') ? (
                        <WaitWord>{shown.word}</WaitWord>
                    ) : (
                        (retiredPartLabel(item) ?? (complete ? 'Done' : (conceptBuildWait(item, data) ?? shown.word)))
                    )}
                </>
            }
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
    const missing = unreadParts(item, parts);

    return (
        <MainSection
            data-concept-parts
            header={
                <SectionHeader
                    // A group with no parts yet says "Parts" over its "No parts planned yet", never "0/0 parts done".
                    heading={
                        item.subIssues.total
                            ? `${item.subIssues.completed}/${item.subIssues.total} parts done`
                            : 'Parts'
                    }
                    bar={<ConceptPartsBar parent={item} parts={parts} />}
                />
            }
        >
            {item.completion && (
                <DetailFact label="Delivery">
                    <ConceptState
                        state={
                            parts.some((part) => part.kind === 'build')
                                ? { ...item.completion, reasons: [] }
                                : item.completion
                        }
                        item={item}
                    />
                </DetailFact>
            )}
            {!parts.length && (
                <DetailFact label="Parts">
                    {item.subIssues.total ? 'Parts are outside the board.' : 'No parts planned yet.'}
                </DetailFact>
            )}
            {!item.releasePlan && item.completion && (
                <DetailFact label="What's left">
                    <ConceptReasons state={item.completion} />
                </DetailFact>
            )}
            {parts.length > 0 && (
                <PartsList>
                    {parts.map((part) => (
                        <ConceptPartRow
                            key={part.item.id}
                            item={part.item}
                            data={data}
                            openPart={openPart}
                            parentRepo={item.repo}
                        />
                    ))}
                </PartsList>
            )}
            {/* Once, muted, after the parts the board shows. */}
            {missing > 0 && (
                <Text variant="caption" tone="muted">
                    {unreadPartsText(missing)}
                </Text>
            )}
            <ConceptOpenQuestions parent={item} parts={parts} data={data} />
        </MainSection>
    );
}
