// The board's one answer to "where is this item and what is it doing": its recorded stage, what its thread is doing now
// (its execution), its pull request's readiness, and from those the one word and glyph every surface shows for it. Rows,
// the item dialog's header and stage bar, the desk, the title bar's counters and the Build heading all ask this, so no
// surface names the same item differently.

import {
    isDecisionWork,
    buildsAtWork,
    limitNumber,
    groupState,
    deskWait,
    needsAnswer,
    stoppedRunThread,
    activityLost,
    activityUnavailable,
    blockerRef,
    buildActivity,
    canResumeShaping,
    canRetryBuild,
    itemActivityLine,
    itemActivityThread,
    openBlockers,
    prReadiness,
    workingAgain,
} from '@lar-factory/shared';
import type { BoardData, Item, Status, ThreadActivityState } from '@lar-factory/shared';
import type { StatusState } from '@lar-works/design-system';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStartStore } from './StartStore';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';

/**
 * What the item's thread is doing now, whatever its recorded stage: a start in flight, at work (quiet when it has taken
 * no action for a while), waiting on you, stopped, or unreadable. None when no thread is under way.
 */
type Execution = 'starting' | 'working' | 'quiet' | 'waiting' | 'stopped' | 'unavailable';

/** One word per execution, the same on every surface; a working build says its phase, such as Implementing, where it
 *  records one. A start's own message says its progress, so it has none. */
const EXECUTION_WORD: Record<Exclude<Execution, 'starting'>, string> = {
    working: 'Working',
    quiet: 'Idle',
    waiting: 'Question',
    stopped: 'Run stopped',
    unavailable: 'Activity unavailable',
};

/** A merged pull request's word while the recorded stage hasn't caught up with it. */
const MERGED = 'PR merged';

export interface ItemState {
    /** The stage the item's record holds, which the stage bar and the board's sections name. */
    stage: Status;
    /** Current board section, including live PR evidence. */
    progressStage: string;
    progressState: StatusState | undefined;
    execution: Execution | undefined;
    /** The first pull request's readiness at Verify or Ready to merge; null elsewhere. */
    pr: ReturnType<typeof prReadiness>;
    /** What every surface says the item is doing now. */
    word: string;
    /** What the stage and pull request say, leaving out what its thread does, for a surface that names that beside it,
     *  such as a Work map node's activity. */
    stageWord: string;
    /** The word's meaning, which colours its glyph; none for a plain stage. */
    state: StatusState | undefined;
    /** The status glyph to draw, unless `state` comes from the pull request, which draws a light. */
    glyph: Status;
    /** The glyph's state when it isn't its status's: off for stopped work, waiting for work that waits on others. */
    glyphState: 'off' | 'waiting' | undefined;
    /** The pull request's readiness, or its merge, draws the glyph as a status light. */
    light: boolean;
    /** The glyph animates: the item's work is known to run and the board's read is current. */
    running: boolean;
    /** At work again at Verify or Ready to merge: counted as in flight, its action is its build thread. */
    working: boolean;
    /** The word already says what the item starts after. */
    blocked: boolean;
    /** The stopped work can't be restarted from the board, so its next step is resuming its thread in T3. */
    resume: boolean;
    /** The recorded stage, when the word says something else; for a tooltip. */
    recorded: string | undefined;
}

/** What the presenter reads beside the item, all of it plain values, so a caller can tell when the answer may change. */
export interface ItemStateInputs {
    /** The board can't trust what it knows of thread activity now. */
    unavailable: boolean;
    /** The item's line, as T3's latest read gives it at the time. */
    line: ThreadActivityState | undefined;
    /** T3's answer for the item's thread is lost. */
    lost: boolean;
    /** A start for the item is in flight, pressed on this page or reported by the server. */
    starting: boolean;
    all?: readonly Item[];
    starts?: BoardData['startProgress'];
    capacityFull?: boolean;
}

/** Whether T3's own run state says the item's work runs, when its activity can't say: a shaping thread, a build thread or
 *  work a build delegated, such as a slice's thread. */
function runsNow(item: Item, stale: boolean): boolean {
    if (stale) return false;

    if (item.status === 'Shaping')
        return (
            Array.isArray(item.threads) &&
            item.threads.some(
                (thread) =>
                    thread.purpose !== 'build' &&
                    !thread.observedAt &&
                    !thread.archived &&
                    (thread.currentRunning || thread.hasRunningChildren),
            )
        );

    return buildActivity(item).running;
}

/** Whether what the board knows of the item's activity is too old or unread to say what runs: a line that reads still
 *  speaks for its thread through another read's error. */
const staleFor = ({ unavailable, line, lost }: ItemStateInputs) =>
    (unavailable && !(line && line !== 'unavailable')) || lost;

function executionOf(item: Item, inputs: ItemStateInputs): Execution | undefined {
    const { line, starting } = inputs;

    // Work the board holds for you, paused or set aside isn't known to run, whatever its thread last said.
    if (item.paused || item.archived || item.needsYou) return undefined;

    if (starting) return 'starting';

    const stale = staleFor(inputs);

    if (workingAgain(item, stale)) return 'working';

    // A finished shaping thread does not become execution of a queued or unstarted build.
    if (['List', 'Queued', 'Ready', 'Done'].includes(item.status)) return undefined;

    if (line === 'waiting' || line === 'stopped' || line === 'working' || line === 'quiet') return line;

    if (runsNow(item, stale)) return 'working';

    return line && 'unavailable';
}

/** A running build's phase, such as Implementing, in place of Working, where the build records one. */
function phaseOf(item: Item, stale: boolean): string {
    const { label, running } = buildActivity(item, stale);

    return running ? label : EXECUTION_WORD.working;
}

/** Stopped work under way that the board can't restart itself and nothing of it still runs or waits: its thread is
 *  resumed in T3. A build the board can retry, or shaping it can resume, keeps those actions. */
const resumable = (item: Item) =>
    (item.status === 'In progress' || item.status === 'Review') &&
    !canRetryBuild(item) &&
    !canResumeShaping(item) &&
    Array.isArray(item.threads) &&
    !item.threads.some(
        (thread) =>
            thread.hasLiveChildren ||
            thread.hasRunningChildren ||
            thread.state === 'running' ||
            thread.state === 'needs you',
    );

/** The one presenter: the item's stage, execution and pull request readiness, and the word and glyph they come to. */
export function itemState(item: Item, inputs: ItemStateInputs): ItemState {
    const execution = executionOf(item, inputs);
    const stale = staleFor(inputs);
    const atWork = execution === 'working' || execution === 'quiet';
    const stageReadiness = prReadiness(item);
    const readiness = atWork ? null : stageReadiness;
    // The pull request merged while the record still holds an earlier stage.
    const prMerged =
        (item.status === 'In progress' || item.status === 'Review') && item.linkedPrs[0]?.state === 'merged';
    const merged = !atWork && !readiness && prMerged;
    // A Ready item's blockers say why it hasn't started, whatever a thread still does.
    const blockers = item.status === 'Ready' && execution !== 'starting' ? openBlockers(item) : [];
    const statusWord = isDecisionWork(item)
        ? item.completion?.complete || item.status === 'Done'
            ? 'Complete'
            : item.status === 'Shaping'
              ? 'Working'
              : item.status
        : item.status;
    const blockedWord = `Blocked · starts after ${blockers.map((blocker) => blockerRef(item, blocker)).join(', ')}`;
    const stageWord = blockers.length ? blockedWord : (stageReadiness?.word ?? (prMerged ? MERGED : statusWord));
    const said = execution && execution !== 'starting' && execution !== 'unavailable' ? execution : undefined;
    const wait =
        !inputs.starting &&
        !atWork &&
        (needsAnswer(item) ||
            item.needsYou ||
            (!stale && stoppedRunThread(item)) ||
            (!readiness && ['Verify', 'Ready to merge'].includes(item.status)))
            ? deskWait(item, stale, inputs.all).label
            : undefined;
    const group = groupState(
        item,
        { items: [...(inputs.all ?? [])], startProgress: inputs.starts },
        inputs.unavailable,
    );
    const slotWait =
        item.status === 'Ready' &&
        item.passingBrief &&
        !item.needsYou &&
        !blockers.length &&
        !inputs.starting &&
        !buildsAtWork({ items: [item] }).length &&
        inputs.capacityFull;
    const word =
        (slotWait ? 'Waiting for a build slot' : undefined) ??
        (item.briefReviewing && !wait ? buildActivity(item, stale).label : undefined) ??
        group?.word ??
        wait ??
        (blockers.length
            ? blockedWord
            : said === 'working'
              ? phaseOf(item, stale)
              : said
                ? EXECUTION_WORD[said]
                : (readiness?.word ??
                  (merged ? MERGED : execution === 'unavailable' ? EXECUTION_WORD.unavailable : statusWord)));
    // Blocked by other work is not your turn: it reads off (grey), as amber is kept for what waits on you.
    const state: StatusState | undefined = blockers.length
        ? 'off'
        : said === 'waiting'
          ? 'waiting'
          : said === 'stopped'
            ? 'off'
            : atWork
              ? undefined
              : (readiness?.state ?? (merged ? 'ready' : undefined));

    return {
        stage: item.status,
        progressStage: isDecisionWork(item)
            ? item.completion?.complete || item.status === 'Done'
                ? 'Outcome'
                : item.status === 'List' || item.status === 'Queued'
                  ? item.status === 'List'
                      ? 'List'
                      : 'Queue'
                  : 'Working'
            : (item.briefApproval || item.briefReviewing) &&
                (item.buildPhase ||
                    item.linkedPrs.length ||
                    (Array.isArray(item.threads) && item.threads.some((thread) => thread.purpose === 'build')))
              ? 'Build'
              : prMerged || stageReadiness?.word === 'Merged'
                ? 'Merge'
                : stageReadiness?.state === 'failed'
                  ? 'Verify'
                  : (
                        {
                            List: 'List',
                            Queued: 'Queue',
                            Shaping: 'Shaping',
                            'Needs you': ['review', 'approve', 'checks', 'retro'].includes(item.buildPhase ?? '')
                                ? 'Review'
                                : item.buildPhase ||
                                    (Array.isArray(item.threads) &&
                                        item.threads.some((thread) => thread.purpose === 'build'))
                                  ? 'Build'
                                  : 'Shaping',
                            Ready: 'Ready to build',
                            'In progress': 'Build',
                            Review: 'Review',
                            Verify: 'Verify',
                            'Ready to merge': 'Merge',
                            Done: 'Merge',
                        } as const
                    )[item.status],
        progressState: stageReadiness?.state ?? state,
        execution,
        pr: readiness,
        word,
        stageWord,
        state,
        // At work again, its glyph and colour are a build's.
        glyph: group?.running
            ? 'In progress'
            : readiness
              ? 'Review'
              : workingAgain(item, stale)
                ? 'In progress'
                : item.status,
        glyphState:
            said === 'stopped' ? 'off' : blockers.length || (!atWork && openBlockers(item).length) ? 'off' : undefined,
        light: Boolean(readiness || merged),
        // A read the board can't trust stills the motion, while a thread's own fresh line still names what it does.
        running: group ? group.running && !inputs.unavailable : atWork && !inputs.unavailable && !blockers.length,
        working: workingAgain(item, stale),
        blocked: blockers.length > 0,
        resume: execution === 'stopped' && resumable(item),
        recorded: word === item.status ? undefined : `Recorded stage: ${item.status}`,
    };
}

/** Whether the board can't trust thread activity: its read failed, went stale or hasn't settled, or T3 itself can't be read. */
const boardUnavailable = ({ data, now, clientError }: { data: BoardData; now: number; clientError: string | null }) =>
    activityUnavailable(data, now, clientError) ||
    !!data.localProblem ||
    (!!data.tools?.t3 && data.tools.t3.result !== 'ok') ||
    (!!data.t3Availability && (data.t3Availability.availability !== 'available' || !!data.t3Availability.observedAt));

/** The ids of the items with a start in flight, pressed here or reported by the server. */
function useStarting(): (item: Item) => boolean {
    // A push makes a new startProgress each time, so this selects the ids, which compare equal when nothing changed.
    const reported = useBoardStore(
        useShallow((state) =>
            Object.entries(state.data.startProgress ?? {})
                .filter(([, starts]) =>
                    Object.values(starts).some(
                        (start) => start.phase === 'starting' || start.phase === 'may-have-started',
                    ),
                )
                .map(([id]) => id),
        ),
    );
    const starts = useStartStore((state) => state.starts);
    const builds = useStartStore((state) => state.builds);

    return (item) =>
        starts[item.id]?.phase === 'pending' || builds[item.id]?.phase === 'pending' || reported.includes(item.id);
}

const capacityFull = ({ data }: { data: BoardData }) =>
    !!data.buildLimit && buildsAtWork(data).length >= limitNumber(data.buildLimit);

export const useBoardUnavailable = () => useBoardStore(boardUnavailable);

/** The presenter for many items at once, such as a counter's or a heading's: read at the time it is called. */
export function useItemStates(): (item: Item) => ItemState {
    const unavailable = useBoardUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);
    const starting = useStarting();
    const all = useBoardStore((state) => state.data.items);
    const starts = useBoardStore((state) => state.data.startProgress);
    const full = useBoardStore(capacityFull);

    return (item) => {
        const now = Date.now();

        return itemState(item, {
            unavailable,
            all,
            starts,
            capacityFull: full,
            line: itemActivityLine(item, now, disconnected)?.state,
            lost: activityLost(itemActivityThread(item)?.activity, now),
            starting: starting(item),
        });
    };
}

/** The presenter for one item, rendering its caller only when the answer may change, not on every second. */
export function useItemState(item: Item): ItemState {
    const unavailable = useBoardUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);
    const starting = useStarting()(item);
    const all = useBoardStore((state) => state.data.items);
    const starts = useBoardStore((state) => state.data.startProgress);
    const full = useBoardStore(capacityFull);
    const line = useClock((now) => itemActivityLine(item, now, disconnected)?.state);
    const lost = useClock((now) => activityLost(itemActivityThread(item)?.activity, now));

    return useMemo(
        () => itemState(item, { unavailable, line, lost, starting, all, starts, capacityFull: full }),
        [item, unavailable, line, lost, starting, all, starts, full],
    );
}
