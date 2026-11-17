// The parts of an item's card (ItemCard): the line that says what comes next, what its PR's checks show, the lanes'
// names, and what a concept part is at while it doesn't wait on you.

import {
    buildActivity,
    checksPhrase,
    dependencyProofs,
    groupState,
    HINTS,
    itemPr,
    needsAnswer,
    pendingBriefBatch,
    prReadiness,
    retroWaits,
} from '@lar-factory/shared';
import type { BoardData, Checks, Item } from '@lar-factory/shared';

import type { Part } from './DossierParts';
import { isDone, openWaits, partActivity } from './DossierParts';
import { ACTIVITY_WORD, partDetail, RUNS } from './MapCardFacts';
import { partState } from './PartState';
import { lastSeen } from './StageStatus';
import { checksStale, checksWord, useActivityUnavailable, useShownStatus } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { type CardCheckState, DeskHint } from '@/ui/board';

/**
 * The line under the title that says what comes next: nothing when the card's action answers it, else the merge state
 * and checks of its PR, or its status's hint. The checks leave out a zero count other than passed.
 */
export function NextStep({ item, waitLabel, checksShown }: { item: Item; waitLabel: string; checksShown: boolean }) {
    const data = useBoardStore((state) => state.data);
    const group = groupState(item, data);

    if (dependencyProofs(item).length || pendingBriefBatch(item, data.items).length) return null;

    if (group) return group.word === waitLabel ? null : <DeskHint>{group.word}</DeskHint>;

    if (retroWaits(item.retro))
        return (
            <DeskHint>{item.status === 'Done' ? 'Optional · Build done' : 'Optional · Delivery continues'}</DeskHint>
        );

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
 * with no open PR, so the stage track shows instead. Checks the board can't vouch for (`checksStale`) keep their counts,
 * dimmed.
 */
export function cardChecks(item: Item, data: BoardData, disconnected: boolean) {
    const pr = item.linkedPrs[0];

    if (!pr || pr.state !== 'open') return undefined;

    const stale = checksStale(item, pr, data, disconnected);
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
export const LANES: Record<string, string> = {
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
export function usePartState(item: Item, part: Part | undefined, data: BoardData, checksShown: boolean) {
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
