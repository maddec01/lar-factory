// An item as the board's one card, the same on Your desk and on a concept's work map: the same head, title, lines and
// foot, from the same rules, so a card never says one thing in one place and another elsewhere. Inside a concept it
// leaves out what the concept already says: its project, the concept it belongs to and the Concepts lane.

import {
    buildActivity,
    checksPhrase,
    dependencyProofs,
    deskParentName,
    deskWait,
    groupState,
    HINTS,
    humanWait,
    itemName,
    itemPr,
    needsAnswer,
    openQuestionThread,
    pendingBriefBatch,
    placementOf,
    prReadiness,
    projectWorkMap,
    questionOwnerParent,
    ref,
    retroWaits,
} from '@lar-factory/shared';
import type { BoardData, Checks, Item } from '@lar-factory/shared';
import { statusStateColors } from '@lar-works/design-system';

import { ActivityLine } from './ActivityLine';
import type { Part } from './DossierParts';
import { isDone, openWaits, partActivity } from './DossierParts';
import { ACTIVITY_WORD, GATE_WORDS, partDetail, RUNS } from './MapCardFacts';
import { PartAction } from './PartAction';
import { partState } from './PartState';
import { PartTitle } from './PartTitle';
import { RowKindMark, RowSource } from './RowIdentity';
import { lastSeen } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { workLabel } from './WorkLabel';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    CardActions,
    checksWord,
    HumanWaitAction,
    ItemTitle,
    SliceBar,
    WorkingBar,
    STATUS_COLOR,
    stepName,
    useActivityUnavailable,
    useShownStatus,
    workflowSteps,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    BoardCard,
    CardChecks,
    type CardCheckState,
    DeskDependencyProof,
    DeskHint,
    MetaLine,
    OneLineAction,
    StageTrack,
} from '@/ui/board';

/**
 * The line under the title that says what comes next: nothing when the card's action answers it, else the merge state
 * and checks of its PR, or its status's hint. The checks leave out a zero count other than passed.
 */
function NextStep({ item, waitLabel, checksShown }: { item: Item; waitLabel: string; checksShown: boolean }) {
    const data = useBoardStore((state) => state.data);
    const group = groupState(item, data);

    if (dependencyProofs(item).length || pendingBriefBatch(item, data.items).length) return null;

    if (group) return group.word === waitLabel ? null : <DeskHint>{group.word}</DeskHint>;

    if (retroWaits(item.retro)) return null;

    if (item.briefApproval) return <DeskHint>{item.briefApproval.reason}</DeskHint>;

    if (needsAnswer(item)) return null;

    const readiness = prReadiness(item);

    // A hint that only repeats the card's status or its button, such as Verify build or Review PR, says nothing more.
    if (readiness)
        return [waitLabel, readiness.action].includes(readiness.word) ? null : <DeskHint>{readiness.word}</DeskHint>;

    const pipeline = itemPr(item)?.pipeline;

    // The head's widget already draws the checks.
    if (checksShown) return null;

    if (pipeline) return <DeskHint>{checksPhrase(pipeline.checks)}</DeskHint>;

    return <DeskHint>{HINTS[item.status]}</DeskHint>;
}

const counts = (checks: Checks) =>
    `${checks.passed} passed · ${checks.running} running · ${checks.failed} failed · ${checks.total} total`;

/**
 * What the card's widget shows of its open PR's checks, with the rest of what the board knows for its tooltip; undefined
 * with no open PR, so the stage track shows instead. Checks the board can't vouch for (disconnected, a project it can't
 * read, a stale observation) keep their counts, dimmed.
 */
function cardChecks(item: Item, data: BoardData, disconnected: boolean) {
    const pr = item.linkedPrs[0];

    if (!pr || pr.state !== 'open') return undefined;

    const stale =
        disconnected ||
        !!data.itemSourceProblems?.some((p) => p.repo === item.repo) ||
        pr.checkProgress?.state === 'stale';
    const unread = pr.pipelineUnread || (!pr.checkProgress && !pr.checks);
    const unavailable = pr.checkProgress?.state === 'unavailable';
    const detail = [
        `PR #${pr.number}`,
        pr.checkProgress?.coverage === 'build-validation' &&
            'Limited coverage: build validation only. Status checks unavailable.',
        pr.checkProgress?.prWideChecks && `PR-wide statuses: ${counts(pr.checkProgress.prWideChecks)}`,
    ]
        .filter(Boolean)
        .join(' · ');
    const checks: CardCheckState = unread
        ? stale || unavailable
            ? 'unavailable'
            : 'loading'
        : unavailable
          ? 'unavailable'
          : pr.checks && pr.checks.total > 0
            ? pr.checks
            : 'none';
    const word = typeof checks === 'object' && pr.checks ? checksWord(pr.checks) : undefined;

    return { checks, word, stale: stale && typeof checks === 'object', detail };
}

/** Each lane's name, as its header says it, for a card to say which stage its item is at. */
const LANES: Record<string, string> = {
    queue: 'Queue',
    shaping: 'Shaping',
    ready: 'Ready to build',
    build: 'Build',
    dock: 'Concepts',
};

/**
 * What a concept part is at while it doesn't wait on you, in the words its parts-list row says: what holds it
 * ("Blocked by Part 15"), else the presenter's stage word, with what its thread does and its run's details; and whether
 * it is held, works or is done, for its leading bar.
 */
function usePartState(item: Item, part: Part | undefined, data: BoardData, checksShown: boolean) {
    const shown = useShownStatus(item);
    const unavailable = useActivityUnavailable();

    if (!part) return null;

    const activity = partActivity(part, shown.working, unavailable);
    const status = partState(item, data, shown.stageWord);
    const running = activity.kind === 'working' ? buildActivity(item, unavailable) : null;
    // A thread at work says the presenter's word (Working, Quiet or its phase), as its row and dialog do.
    const word =
        activity.kind === 'working' && (shown.execution === 'working' || shown.execution === 'quiet')
            ? shown.word
            : running?.running
              ? running.label
              : activity.kind === 'finished' && !RUNS.includes(item.status)
                ? null
                : activity.kind === 'needs you'
                  ? null
                  : ACTIVITY_WORD[activity.kind];
    const seen = word && activity.thread ? lastSeen(activity.thread) : '';
    const heldBySlice = activity.kind === 'child waiting' && item.slices.some((s) => s.progress === 'blocked');
    // One fact once: a run says In progress already, and an activity the status already says is left out.
    const facts = [
        ...(status === 'In progress' && activity.kind === 'working' ? [] : [status]),
        ...(word && word !== status && !heldBySlice ? [`${word}${seen}`] : []),
        ...partDetail(part, activity),
    ].filter((fact) => !(checksShown && fact.startsWith('Checks ')));
    const complete = isDone(item);
    const held = !complete && (/^(Blocked|Waits on|Waiting)/.test(status) || openWaits(part).length > 0);

    return {
        status: facts.join(' · '),
        tone: complete
            ? ('done' as const)
            : held
              ? ('held' as const)
              : shown.running || activity.kind === 'working' || status === 'Working'
                ? ('active' as const)
                : undefined,
        held,
    };
}

/**
 * An item as the board's one card. On Your desk it waits on you; on a work map (`part`, at `width` by `height`) it is a
 * concept's part, which may wait on you, on other work, or on nothing, and names `history`, the finished parts it
 * followed, in its tooltip. Either way it shows the same parts: where its ticket is saved (and its project, outside a
 * concept) and where its work stands; its kind and title; its question, what it belongs to (outside a concept), what
 * comes next, its briefs and dependency proofs, and what its thread does while it works for itself; and at its foot what
 * it is at, in amber when that is you, and how long ago it moved, with its action over the foot's end on hover.
 */
export function ItemCard({
    item,
    data,
    part,
    width,
    height,
    history,
}: {
    item: Item;
    data: BoardData;
    /** The concept part this card stands for on a work map. */
    part?: Part;
    width?: number;
    height?: number;
    history?: string | undefined;
}) {
    const inConcept = !!part;
    const shown = useShownStatus(item);
    const unavailable = useActivityUnavailable();
    const picked = useItemDialogStore((state) => state.itemId === item.id);
    const disconnected = useBoardStore((state) => !!state.clientError);
    const activityState = useActivityState(item);
    const complete = isDone(item);
    // Everything on Your desk waits on you, a finished build's follow-ups too; a part does while a person's answer or
    // approval holds it, until it is done.
    const asks = !inConcept || (!complete && !!humanWait(item, unavailable, data.items));
    const wait = deskWait(item, unavailable, data.items);
    const followups = retroWaits(item.retro);
    const checks = cardChecks(item, data, disconnected);
    const idle = usePartState(item, asks ? undefined : part, data, !!checks);
    const record = part ? projectWorkMap([item]).nodes[0] : undefined;
    const recordState = record
        ? [record.queued ? null : 'Not queued', record.gate === 'not applicable' ? null : GATE_WORDS[record.gate]]
              .filter(Boolean)
              .join(' · ')
        : '';
    const steps = workflowSteps(item);
    const at = steps.findIndex((step) => step === shown.progressStage);
    // Its lane, then its step when that says more, such as "Build · Verify"; inside a concept the lane goes unsaid.
    const lane = inConcept
        ? undefined
        : placementOf(item, { starts: data.startProgress?.[item.id], unavailable, all: data.items }).sections.find(
              (section) => section !== 'desk',
          );
    const step =
        at >= 0
            ? [lane && LANES[lane], stepName(steps[at]!)]
                  .filter((word, i, words) => word && words.indexOf(word) === i)
                  .join(' · ')
            : '';
    const requestOwner = openQuestionThread(item) ?? openQuestionThread(questionOwnerParent(item, data.items) ?? item);
    const parentName = inConcept ? undefined : deskParentName(item, data.items);
    const members = pendingBriefBatch(item, data.items).map((member) => member.title);
    const quiet = !!idle?.held;
    const still = useActivityStill(item);
    // What it is at while it runs, in the word its row says (Implementing, Checks…); held by other work, it isn't.
    const atWork = complete || quiet ? undefined : workLabel(item, activityState === 'working' || activityState === 'quiet');
    const sliceCount = item.slices.length
        ? `${item.slices.filter((slice) => slice.progress === 'done').length}/${item.slices.length} slices`
        : '';
    // The wait in the same words everywhere it shows: the card's foot, the dialog's Status and search.
    const status = asks
        ? followups
            ? `${wait.label} · ${item.retro?.suggestions?.length ?? 0}`
            : wait.label
        : atWork
          ? [atWork, sliceCount].filter(Boolean).join(' · ')
          : (idle?.status ?? '');
    const action = asks ? <HumanWaitAction item={item} data={data} quiet /> : part && <PartAction part={part} data={data} />;

    return (
        <BoardCard
            {...(part ? { 'data-map-part': item.id, 'data-map-card': true, 'data-map-held': quiet || undefined } : {})}
            {...(width && height ? { style: { width, height } } : {})}
            tone={asks ? 'waiting' : idle?.tone}
            picked={picked}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            openLabel={`Open ${ref(item)}`}
            tooltip={[itemName(item), status, recordState, record?.waits.join(' · '), history].filter(Boolean).join(' · ')}
            // Where its ticket is saved and, outside a concept, its project; its kind before its title.
            head={<RowSource item={item} always project={!inConcept} />}
            kind={<RowKindMark item={item} />}
            track={
                checks ? (
                    // An open PR's checks are what move, so they take the track's place: its step, the PR's mark and its
                    // checks in a word and segments.
                    <CardChecks
                        checks={checks.checks}
                        stale={checks.stale}
                        detail={checks.detail}
                        step={at >= 0 ? stepName(steps[at]!) : ''}
                        {...(checks.word ? { word: checks.word } : {})}
                    />
                ) : (
                    at >= 0 && (
                        <StageTrack
                            steps={steps.length}
                            at={at}
                            // Held by other work, its track goes quiet so the foot's "Blocked by #139" is its state.
                            color={
                                quiet
                                    ? statusStateColors.off
                                    : shown.progressState
                                      ? statusStateColors[shown.progressState]
                                      : STATUS_COLOR[item.status]
                            }
                            label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}
                            step={step}
                        />
                    )
                )
            }
            // A part's number leads its title, "#139" or "Part 15", as its parts-list row and every blocker name it.
            name={inConcept ? <PartTitle item={item} /> : <ItemTitle item={item} />}
            status={status}
            statusTone={asks ? 'waiting' : 'plain'}
            statusTitle={[status, step].filter(Boolean).join(' · ')}
            sub={
                <>
                    {requestOwner?.questionSummary && (
                        <span className="text-fg-soft" title={requestOwner.questionSummary} data-question>
                            {requestOwner.questionSummary}
                        </span>
                    )}
                    {parentName && (
                        <span title={parentName} data-part-of>
                            in {parentName}
                        </span>
                    )}
                    {(asks || !complete) && <NextStep item={item} waitLabel={wait.label} checksShown={!!checks} />}
                    {members.length > 0 && (
                        <p className="m-0">
                            Briefs: <MetaLine parts={members} />
                        </p>
                    )}
                    {!followups && <DeskDependencyProof proofs={dependencyProofs(item)} />}
                    {/* What its thread does now, while it works on its own; waiting on you, the foot already says so. */}
                    {!asks && !complete && activityState && (
                        <span className="flex min-w-0" data-map-activity>
                            <ActivityLine item={item} />
                        </span>
                    )}
                </>
            }
            age={<Age at={item.updatedAt} />}
            // A map card's action is named, never the rows' icon-only form, tinted like the rows' actions, or outlined as
            // on Your desk while it waits on you (CardActions).
            action={
                action &&
                (part ? (
                    <CardActions outlined={asks}>
                        <OneLineAction>{action}</OneLineAction>
                    </CardActions>
                ) : (
                    action
                ))
            }
            // Under the foot, its progress as its row draws it: its slices, else one bar while it runs; an open PR's checks
            // take the head's track instead.
            bottom={
                !checks &&
                (item.slices.length > 0 || atWork) && (
                    <span className="shrink-0" data-map-slices>
                        {item.slices.length > 0 ? (
                            <SliceBar item={item} still={still} />
                        ) : (
                            <WorkingBar label={atWork!} still={still} />
                        )}
                    </span>
                )
            }
        />
    );
}
