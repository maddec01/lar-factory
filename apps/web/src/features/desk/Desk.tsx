// Your desk: the items awaiting your action, including shaping and concept questions, as small cards in one row that
// scrolls sideways under the page's padding to the window's edges. A card opens the item dialog. Every card has the
// same four rows at the same heights, so they line up across cards: source, repository, kind and age, in a stage
// row's order; the title; the status and next step; and the card's action in the right corner, with Open thread as an
// icon beside it. Scope, Kind and Labels narrow the cards. An empty desk is one small line, which while the board is
// disconnected only speaks for the last read, during a first read that may still add items is the loader, and says so
// when Scope, Kind and Labels hide every card.

import {
    deskItems,
    pendingBriefBatch,
    openQuestionThread,
    questionOwnerParent,
    groupState,
    retroWaits,
    deskParentName,
    needsAnswer,
    deskWait,
    checksPhrase,
    HINTS,
    itemPr,
    itemName,
    readingScope,
    prReadiness,
} from '@lar-factory/shared';
import type { BoardData, Item, Checks } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';

import { rowFilter, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    HumanWaitAction,
    Age,
    AzureFields,
    ItemTitle,
    useActivityUnavailable,
    ItemStatusGlyph,
    useShownStatus,
} from '@/features/items';
import { RowKind, RowSource } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    ApprovalWait,
    boardStatusState,
    DeskCard as Card,
    DeskPrProgress,
    DeskHint,
    DeskSection,
    noteBoardPlaces,
} from '@/ui/board';

/**
 * The line beside the card's action: nothing when that action answers the question, else the merge state and checks of the PR Open PR opens, or the status's hint. The checks
 * leave out a zero count other than passed.
 */
function NextStep({ item, waitLabel }: { item: Item; waitLabel: string }) {
    const data = useBoardStore((state) => state.data);
    const group = groupState(item, data);

    const batch = pendingBriefBatch(item, data.items);

    if (batch.length) return null;

    if (group) return group.word === waitLabel ? null : <DeskHint>{group.word}</DeskHint>;

    if (retroWaits(item.retro)) return null;

    if (item.briefApproval) return <DeskHint>{item.briefApproval.reason}</DeskHint>;

    if (needsAnswer(item)) return null;

    if (prReadiness(item)) return <DeskHint>{prReadiness(item)?.word}</DeskHint>;

    const pipeline = itemPr(item)?.pipeline;

    if (pipeline) {
        return <DeskHint>{checksPhrase(pipeline.checks)}</DeskHint>;
    }

    return <DeskHint>{HINTS[item.status]}</DeskHint>;
}

const counts = (checks: Checks) =>
    `${checks.passed} passed · ${checks.running} running · ${checks.failed} failed · ${checks.total} total`;

function Progress({ item, data }: { item: Item; data: BoardData }) {
    const disconnected = useBoardStore((state) => state.clientError);
    const pr = item.linkedPrs[0];

    if (!pr || pr.state !== 'open') return null;

    const stale =
        disconnected ||
        data.itemSourceProblems?.some((p) => p.repo === item.repo) ||
        pr.checkProgress?.state === 'stale';
    const unread = pr.pipelineUnread || (!pr.checkProgress && !pr.checks);
    const unavailable = pr.checkProgress?.state === 'unavailable';
    const limited = pr.checkProgress?.coverage === 'build-validation';

    return (
        <DeskPrProgress
            label={`PR #${pr.number}`}
            summary={
                unread
                    ? stale || unavailable
                        ? 'Checks unavailable. Not yet observed.'
                        : 'Loading checks…'
                    : unavailable
                      ? 'Check evidence unavailable.'
                      : pr.checks
                        ? counts(pr.checks)
                        : 'No checks reported. 0 total.'
            }
            note={
                [
                    stale && 'Stale check observation.',
                    limited && 'Limited coverage: build validation only. Status checks unavailable.',
                ]
                    .filter(Boolean)
                    .join(' ') || undefined
            }
            wide={pr.checkProgress?.prWideChecks ? counts(pr.checkProgress.prWideChecks) : undefined}
        />
    );
}

function DeskCard({ item, data }: { item: Item; data: BoardData }) {
    const shown = useShownStatus(item);
    const wait = deskWait(item, useActivityUnavailable(), data.items);
    const followups = retroWaits(item.retro);
    const batch = pendingBriefBatch(item, data.items);
    const requestOwner = openQuestionThread(item) ?? openQuestionThread(questionOwnerParent(item, data.items) ?? item);
    const approval = requestOwner?.pendingRequest?.kind === 'tool-approval' ? requestOwner : undefined;
    const picked = useItemDialogStore((state) => state.itemId === item.id);

    return (
        <Card
            item={item.id}
            picked={picked}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            source={<RowSource item={item} />}
            kind={<RowKind item={item} />}
            age={<Age at={item.updatedAt} />}
            title={<ItemTitle item={item} />}
            name={itemName(item)}
            parentName={deskParentName(item, data.items)}
            members={batch.map((part) => part.title)}
            details={
                !followups && (
                    <>
                        {approval && (
                            <ApprovalWait
                                owner={
                                    approval.pendingRequest?.ownerTitle ??
                                    approval.pendingRequest?.threadId ??
                                    approval.title
                                }
                                summary={approval.questionSummary}
                            />
                        )}
                        <AzureFields azure={item.azure} />
                        <Progress item={item} data={data} />
                    </>
                )
            }
            statusIcon={<ItemStatusGlyph item={item} />}
            status={followups ? `${wait.label} · ${item.retro?.suggestions?.length ?? 0}` : wait.label}
            statusState={
                followups || batch.length || wait.label === 'Outcome check'
                    ? 'waiting'
                    : (shown.state ?? boardStatusState[shown.glyph])
            }
            next={<NextStep item={item} waitLabel={wait.label} />}
            actions={<HumanWaitAction item={item} data={data} />}
        />
    );
}

/** `inScope` are the items in the main area's scope. */
export function Desk({ items: inScope }: { items: Item[] }) {
    const data = useBoardStore((state) => state.data);
    const clientError = useBoardStore((state) => state.clientError);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const scoped = new Set(inScope.map((item) => item.id));
    const shows = rowFilter(filters, data.repos);
    const items = deskItems(data, unavailable).filter((item) => scoped.has(item.id) && shows(item));
    const scope = useShownScope();

    // A card that lands on the desk pulses once, whatever the scope and filters show.
    noteBoardPlaces('desk', new Map(deskItems(data, unavailable).map((item) => [item.id, 0])), data.firstRead.settled);

    return (
        <DeskSection
            title="Your desk"
            count={items.length}
            loading={items.length === 0 && readingScope(data, scope ?? undefined)}
            empty={
                clientError ? (
                    'Nothing waited on you at the last read.'
                ) : readingScope(data, scope ?? undefined) ? (
                    <Loading presentation="inline" label="Loading projects…" />
                ) : deskItems(data, unavailable).length ? (
                    'Nothing on your desk matches the filters.'
                ) : (
                    'Nothing waits on you.'
                )
            }
        >
            {items.map((i) => (
                <DeskCard key={i.id} item={i} data={data} />
            ))}
        </DeskSection>
    );
}
