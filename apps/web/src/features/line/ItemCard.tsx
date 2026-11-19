// An item as the board's one card, the same on Your desk and on a concept's work map: the same head, title, lines and
// foot, from the same rules, so a card never says one thing in one place and another elsewhere. Inside a concept it
// leaves out what the concept already says: its project, the concept it belongs to and the Concepts lane.

import {
    deliveryPrStatus,
    dependencyProofs,
    deskParentName,
    deskWait,
    humanWait,
    itemName,
    openQuestionThread,
    pendingBriefBatch,
    placementOf,
    projectWorkMap,
    questionOwnerParent,
    ref,
    retroWaits,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { statusStateColors } from '@lar-works/design-system';

import { ActivityLine } from './ActivityLine';
import type { Part } from './DossierParts';
import { isDone } from './DossierParts';
import { CardProgress, cardChecks, LANES, NextStep, usePartState } from './ItemCardParts';
import { GATE_WORDS } from './MapCardFacts';
import { PartAction } from './PartAction';
import { PartTitle } from './PartTitle';
import { RowKindMark, RowSource } from './RowIdentity';
import { reviewCount, reviewing } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { workLabel } from './WorkLabel';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    CardActions,
    HumanWaitAction,
    ItemTitle,
    STATUS_COLOR,
    stepName,
    useActivityUnavailable,
    useShownStatus,
    workflowSteps,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    BoardCard,
    CardActivity,
    CardBriefs,
    CardChecks,
    CardPartOf,
    CardQuestion,
    DeskDependencyProof,
    OneLineAction,
    StageTrack,
} from '@/ui/board';

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
    const delivery = deliveryPrStatus(item, unavailable);
    const comments = wait.action?.kind === 'pr-feedback' ? item.linkedPrs[0]?.review?.comments : undefined;
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
    // A thread paused on you (a question, an approval) keeps its bar, its light travelling in amber.
    const waiting = activityState === 'waiting';
    const atWork =
        complete || quiet
            ? undefined
            : workLabel(item, activityState === 'working' || activityState === 'quiet', waiting);
    // While a review round runs, its reviewers are what the card counts and ticks, as a row's progress cell does.
    const reviewers = !complete && reviewing(item);
    const count = reviewers
        ? reviewCount(item)
        : item.slices.length
          ? `${item.slices.filter((slice) => slice.progress === 'done').length}/${item.slices.length} slices`
          : '';
    // The wait in the same words everywhere it shows: the card's foot, the dialog's Status and search.
    const status =
        !asks && shown.prStatus
            ? shown.prStatus
            : asks
              ? comments?.length
                  ? `${wait.label} · ${comments.length} comment${comments.length === 1 ? '' : 's'}`
                  : wait.label === 'Choose follow-ups'
                    ? `${wait.label} · ${item.retro?.suggestions?.length ?? 0}`
                    : wait.label
              : atWork
                ? [atWork, count].filter(Boolean).join(' · ')
                : [idle?.status, reviewers && count].filter(Boolean).join(' · ');
    const action = asks ? <HumanWaitAction item={item} data={data} /> : part && <PartAction part={part} data={data} />;

    return (
        <BoardCard
            {...(part ? { 'data-map-part': item.id, 'data-map-card': true, 'data-map-held': quiet || undefined } : {})}
            {...(width && height ? { style: { width, height } } : {})}
            tone={asks ? 'waiting' : idle?.tone}
            picked={picked}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            openLabel={`Open ${ref(item)}`}
            tooltip={[itemName(item), status, recordState, record?.waits.join(' · '), history]
                .filter(Boolean)
                .join(' · ')}
            // Where its ticket is saved and, outside a concept, its project; its kind before its title.
            head={<RowSource item={item} project={!inConcept} />}
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
            // Every card's status takes a dot in its state's colour, as a row's state and a server scan's lane do: amber
            // when it waits on you, blue while it works, green once done, red when blocked, grey otherwise.
            statusDot={
                statusStateColors[
                    asks
                        ? 'waiting'
                        : complete
                          ? 'ready'
                          : quiet
                            ? status.startsWith('Blocked')
                                ? 'failed'
                                : 'off'
                            : atWork || idle?.tone === 'active'
                              ? 'active'
                              : 'off'
                ]
            }
            sub={
                <>
                    {wait.action?.kind === 'pr-feedback' &&
                        comments?.map((comment) => (
                            <CardQuestion
                                key={comment.id}
                            >{`${comment.author}: ${comment.body.slice(0, 240) || 'Changes requested'}`}</CardQuestion>
                        ))}
                    {delivery && !delivery.running && !delivery.feedback && (
                        <CardQuestion>
                            {delivery.handback
                                ? 'The factory’s part is done. Review and merge the PR.'
                                : (delivery.reason ?? delivery.label)}
                        </CardQuestion>
                    )}
                    {followups && wait.label !== 'Choose follow-ups' && (
                        <CardQuestion>{`Choose follow-ups (optional) · ${item.retro?.suggestions?.length ?? 0}`}</CardQuestion>
                    )}
                    {requestOwner?.questionSummary && <CardQuestion>{requestOwner.questionSummary}</CardQuestion>}
                    {parentName && <CardPartOf name={parentName} />}
                    {(asks || !complete) && <NextStep item={item} waitLabel={wait.label} checksShown={!!checks} />}
                    {members.length > 0 && <CardBriefs members={members} />}
                    {!followups && <DeskDependencyProof proofs={dependencyProofs(item)} />}
                    {/* What its thread does now, while it works on its own; waiting on you, the foot already says so. */}
                    {!asks && !complete && activityState && (
                        <CardActivity>
                            <ActivityLine item={item} />
                        </CardActivity>
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
            // Under the foot, its progress as its row draws it: its reviewers while a round runs (each named in the
            // ticks' tooltip), else its slices, else one bar while it runs; an open PR's checks take the head's track.
            bottom={
                <CardProgress
                    item={item}
                    still={still}
                    reviewers={reviewers}
                    hidden={!!checks}
                    atWork={atWork}
                    waiting={waiting}
                />
            }
        />
    );
}
