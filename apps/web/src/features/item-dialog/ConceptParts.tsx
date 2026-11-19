// What a concept's details add about its parts: its own cost beside its total on the board, and every part on the board,
// each as its row on the board reads with every agent figure, and what its refinement and delivery still need, in
// words. Parts off the board aren't listed; the count above says how many and why.

import { duration, formatTokens, formatUsd, plural, trackerCapabilities } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import { TicketLinks } from './ItemRelations';
import { sidebarSubTickets, subTicketsInParts } from './Relations';
import { useConceptTotal } from './useConceptTotal';
import { useDetailsWait } from './useDetailsWait';
import { hasFigures, INCOMPLETE_TOTAL, useLastKnown } from '@/features/items';
import {
    ConceptOpenQuestions,
    ConceptPartsBar,
    isDone,
    PartsList,
    partsOf,
    unreadParts,
    unreadPartsText,
} from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { FigureRows, MainSection, SectionHeader, TicketLinkPlaceholders, workHoldReason } from '@/ui/board';

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

    const counts = [...unfinished].map(([kind, ids]) => {
        if (kind !== 'decision') return `${plural(ids.length, kind)} remaining`;

        // A decision nobody has started isn't a question for the owner yet; one under way is open.
        const notStarted = ids.filter((id) =>
            ['Queued', 'List'].includes(items.find((item) => item.id === id)?.status ?? ''),
        ).length;

        return [
            notStarted && `${plural(notStarted, 'decision')} not started`,
            ids.length - notStarted && plural(ids.length - notStarted, 'open decision'),
        ]
            .filter(Boolean)
            .join(' · ');
    });
    const names = [...unfinished.values()].flat().flatMap((id) => items.find((item) => item.id === id)?.title ?? []);

    return {
        text: [...counts, ...others.map((reason) => reason.replace(/[.]$/, ''))].join(' · '),
        names: names.join(', '),
    };
}

/** A concept's Refinement or Delivery: Complete, or what it still needs, naming unfinished parts in its tooltip. */
export function ConceptState({ state, item }: { state: { complete: boolean; reasons: string[] }; item?: Item }) {
    const items = useBoardStore((board) => board.data.items);
    const builds = item && partsOf(item, items).filter((part) => part.kind === 'build' && !part.item.setAside);
    const otherReasons = state.reasons.filter((reason) => !reason.startsWith('Its build '));

    if (builds?.length)
        return (
            <>
                {builds.filter((part) => isDone(part.item)).length}/{builds.length} builds done
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

/** The concept's total with its parts in the sidebar, after the concept's own figures: under "Including parts", one
 *  phrase naming its cost, agent time and tokens, as the concept's own are; with none of its own, a "This concept"
 *  heading says so first, so each set of figures names its scope. The tooltip names every figure and says when they
 *  are the last known. */
export function ConceptWork({ item }: { item: Item }) {
    const total = useConceptTotal(item);
    const lastKnown = useLastKnown(item);

    if (!total) return null;

    const own = item.stats && item.stats !== 'unavailable' && hasFigures(item.stats);
    const cost = total.costUsd === undefined ? null : `${formatUsd(total.costUsd)}${total.incomplete ? '+' : ''}`;
    const time = duration(total.agentMs);
    const tokens = formatTokens(total.tokens);
    const figures = [...(cost ? [cost] : []), `${time} agent time`, `${tokens} tokens`];
    const title = [`Agent time ${time}`, `Tokens ${tokens}`, cost && `Cost ${cost}`].filter(Boolean).join(' · ');

    return (
        <>
            {!own && <FigureRows heading="This concept" figures={[]} note="No agent work of its own." />}
            <FigureRows
                heading="Including parts"
                figures={figures}
                title={[title, !total.frozen && lastKnown, total.incomplete && INCOMPLETE_TOTAL]
                    .filter(Boolean)
                    .join('. ')}
                data-concept-work
            />
        </>
    );
}

export function ConceptParts({
    item,
    data,
    openPart,
    read,
}: {
    item: Item;
    data: BoardData;
    openPart: (itemId: string) => void;
    /** The item's details, whose sub-tickets a group made only of them lists under its count once they load. */
    read?: ItemDetailsRead;
}) {
    const parts = partsOf(item, data.items);
    const missing = unreadParts(item, parts);
    // Parts that are only its tracker's sub-tickets (such as Azure tasks) are counted there, in one line, and listed
    // under it once the details load; the sidebar doesn't list them again.
    const tracked = subTicketsInParts(item, data.items);
    const subTickets = tracked && read?.state === 'loaded' ? sidebarSubTickets(item, read.details.subTickets) : [];
    // While they load, a placeholder line for each holds their place, until the read takes too long and the loading line
    // below gives way to Try again.
    const loading = tracked && read?.state === 'loading';
    const waited = useDetailsWait(item.id, loading);
    const tracker = trackerCapabilities(item.repo).place;

    return (
        <MainSection
            data-concept-parts
            header={
                <SectionHeader
                    // A group with no parts yet says "Parts" over its "No parts planned yet", never "0/0 parts done".
                    heading={
                        tracked
                            ? `${plural(item.subIssues.total, 'sub-ticket')} ${tracker} · ${item.subIssues.completed} done`
                            : item.subIssues.total
                              ? `${item.subIssues.completed}/${item.subIssues.total} parts done`
                              : 'Parts'
                    }
                    bar={<ConceptPartsBar parent={item} parts={parts} />}
                    empty={!parts.length && !tracked ? 'No parts planned yet.' : undefined}
                />
            }
        >
            {/* One line for where delivery stands: builds done, then what's left. */}
            {item.completion && (
                <Text variant="caption" tone="muted" data-concept-delivery>
                    <ConceptState
                        state={
                            parts.some((part) => part.kind === 'build')
                                ? { ...item.completion, reasons: [] }
                                : item.completion
                        }
                        item={item}
                    />
                    {!item.releasePlan &&
                        !item.completion.complete &&
                        item.completion.reasons.some((reason) => !reason.startsWith('Its build ')) && (
                            <>
                                {' · '}
                                {/* The builds count is said just before; the rest is what's left besides. */}
                                <ConceptReasons
                                    state={{
                                        ...item.completion,
                                        reasons: item.completion.reasons.filter(
                                            (reason) => !reason.startsWith('Its build '),
                                        ),
                                    }}
                                />
                            </>
                        )}
                </Text>
            )}
            {/* The board's own part rows, what's still to do first, done and set-aside parts folded under one toggle, one
                line each: a summary of what the board says in full. */}
            {parts.length > 0 && (
                <PartsList parts={parts} data={data} home={item.repo} openFirst onOpen={(part) => openPart(part.id)} />
            )}
            {subTickets.length > 0 && <TicketLinks tickets={subTickets} row />}
            {loading && waited !== 'too long' && item.subIssues.total > 0 && (
                <TicketLinkPlaceholders
                    count={item.subIssues.total}
                    label={`Loading ${plural(item.subIssues.total, 'sub-ticket')}`}
                />
            )}
            {/* Once, muted, after the parts the board shows. */}
            {missing > 0 && !tracked && (
                <Text variant="caption" tone="muted">
                    {unreadPartsText(missing)}
                </Text>
            )}
            <ConceptOpenQuestions parent={item} parts={parts} data={data} />
        </MainSection>
    );
}
