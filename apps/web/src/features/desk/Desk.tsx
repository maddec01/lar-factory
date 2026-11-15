// Your desk: the items awaiting your action, including shaping and concept questions, as a list of rows on the stage
// rows' columns: status light, kind and title, project, then what it waits for and its age, and its action at the end,
// with Open thread as an icon beside it. A row opens the item dialog. Scope, Kind and Labels narrow the rows. An empty desk is one small line, which while the board is
// disconnected only speaks for the last read, during a first read that may still add items is the loader, and says so
// when Scope, Kind and Labels hide every card.

import {
    deskItems,
    dependencyProofs,
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
    placementOf,
} from '@lar-factory/shared';
import type { BoardData, Item, Checks } from '@lar-factory/shared';
import { Loading, statusStateColors } from '@lar-works/design-system';

import { rowFilter, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    HumanWaitAction,
    AzureFields,
    ItemTitle,
    useActivityUnavailable,
    useShownStatus,
    STATUS_COLOR,
    workflowSteps,
    stepName,
    prChecks,
    checksWord,
} from '@/features/items';
import { RowKindMark, RowSource } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    ApprovalWait,
    DeskCard as Card,
    DeskPrProgress,
    DeskDependencyProof,
    DeskHint,
    DeskSection,
    HeaderEmpty,
    noteBoardPlaces,
    StageTrack,
    CardChecks,
} from '@/ui/board';

/**
 * The line beside the card's action: nothing when that action answers the question, else the merge state and checks of the PR Open PR opens, or the status's hint. The checks
 * leave out a zero count other than passed.
 */
function NextStep({ item, waitLabel }: { item: Item; waitLabel: string }) {
    const data = useBoardStore((state) => state.data);
    const group = groupState(item, data);

    const batch = pendingBriefBatch(item, data.items);
    const proofs = dependencyProofs(item);

    if (proofs.length) return null;

    if (batch.length) return null;

    if (group) return group.word === waitLabel ? null : <DeskHint>{group.word}</DeskHint>;

    if (retroWaits(item.retro)) return null;

    if (item.briefApproval) return <DeskHint>{item.briefApproval.reason}</DeskHint>;

    if (needsAnswer(item)) return null;

    const readiness = prReadiness(item);

    // A hint that only repeats the card's status or its button, such as Verify build or Review PR, says nothing more.
    if (readiness)
        return [waitLabel, readiness.action].includes(readiness.word) ? null : <DeskHint>{readiness.word}</DeskHint>;

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
                unread ? (
                    stale || unavailable ? (
                        'Checks unavailable. Not yet observed.'
                    ) : (
                        <Loading presentation="inline" label="Loading checks…" />
                    )
                ) : unavailable ? (
                    'Check evidence unavailable.'
                ) : pr.checks ? (
                    counts(pr.checks)
                ) : (
                    'No checks yet.'
                )
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

/** Each lane's name, as its header says it, for a desk row to say which stage its item is at. */
const LANES: Record<string, string> = {
    queue: 'Queue',
    shaping: 'Shaping',
    ready: 'Ready to build',
    build: 'Build',
    dock: 'Concepts',
};

function DeskCard({ item, data }: { item: Item; data: BoardData }) {
    const shown = useShownStatus(item);
    const unavailable = useActivityUnavailable();
    const wait = deskWait(item, unavailable, data.items);
    const lane = placementOf(item, {
        starts: data.startProgress?.[item.id],
        unavailable,
        all: data.items,
    }).sections.find((section) => section !== 'desk');
    const followups = retroWaits(item.retro);
    const batch = pendingBriefBatch(item, data.items);
    const requestOwner = openQuestionThread(item) ?? openQuestionThread(questionOwnerParent(item, data.items) ?? item);
    const approval = requestOwner?.pendingRequest?.kind === 'tool-approval' ? requestOwner : undefined;
    const picked = useItemDialogStore((state) => state.itemId === item.id);
    const steps = workflowSteps(item);
    const at = steps.findIndex((step) => step === shown.progressStage);
    // The lane it sits in, then its step when that says more, such as "Build · Verify".
    const step =
        at >= 0
            ? [lane && LANES[lane], stepName(steps[at]!)]
                  .filter((word, i, words) => word && words.indexOf(word) === i)
                  .join(' · ')
            : '';
    // A disconnected board or a project it can't read leaves the checks as last seen, so the card keeps the counts in
    // words with their stale warning rather than a track that looks current.
    const stale = useBoardStore(
        (state) => !!state.clientError || !!state.data.itemSourceProblems?.some((p) => p.repo === item.repo),
    );
    const checks = stale ? null : prChecks(item);

    return (
        <Card
            item={item.id}
            picked={picked}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            source={<RowSource item={item} />}
            kind={<RowKindMark item={item} labelled />}
            stage={lane && LANES[lane]}
            step={at >= 0 ? steps[at] : undefined}
            question={requestOwner?.questionSummary}
            track={
                checks ? (
                    // In review the PR's checks are what move, so they take the mini track's place: its step, then the PR's mark
                    // and its checks in a word.
                    <CardChecks checks={checks} step={at >= 0 ? stepName(steps[at]!) : ''} word={checksWord(checks)} />
                ) : (
                    at >= 0 && (
                        <StageTrack
                            steps={steps.length}
                            at={at}
                            color={
                                shown.progressState ? statusStateColors[shown.progressState] : STATUS_COLOR[item.status]
                            }
                            label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}
                            step={step}
                        />
                    )
                )
            }
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
                        <DeskDependencyProof proofs={dependencyProofs(item)} />
                        <AzureFields azure={item.azure} />
                        {/* The head's track says the checks; the counts in words stay for a PR it can't draw. */}
                        {!checks && <Progress item={item} data={data} />}
                    </>
                )
            }
            // The wait in the same words everywhere it shows: the card's foot, the dialog's Status and search.
            status={followups ? `${wait.label} · ${item.retro?.suggestions?.length ?? 0}` : wait.label}
            age={<Age at={item.updatedAt} />}
            next={!checks && <NextStep item={item} waitLabel={wait.label} />}
            actions={<HumanWaitAction item={item} data={data} quiet />}
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
                <HeaderEmpty>
                    {clientError ? (
                        'Nothing waited on you at the last read.'
                    ) : readingScope(data, scope ?? undefined) ? (
                        <Loading presentation="inline" label="Loading projects…" />
                    ) : deskItems(data, unavailable).length ? (
                        'Nothing on your desk matches the filters.'
                    ) : (
                        'Nothing waits on you.'
                    )}
                </HeaderEmpty>
            }
        >
            {items.map((i) => (
                <DeskCard key={i.id} item={i} data={data} />
            ))}
        </DeskSection>
    );
}
