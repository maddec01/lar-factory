import { decisionType, limitNumber, type BoardData } from './board-domain.ts';
import type { Item } from './item-domain.ts';
import { openBlockers } from './item-domain.ts';
import { blockerRef } from './presentation.ts';
import { buildsAtWork, canResumeShaping } from './thread-domain.ts';

/** A new Ready delivery waits for capacity; resuming a reserved build or one with a PR needs no new slot. */
export const buildWaitsForSlot = (item: Item, data: BoardData): boolean =>
    item.status === 'Ready' &&
    item.kind !== 'concept' &&
    !!data.buildLimit &&
    !item.linkedPrs?.length &&
    !buildsAtWork({ items: [item] }).length &&
    buildsAtWork(data).length >= limitNumber(data.buildLimit);

/** Local kinds win; legacy unrecorded tickets may still carry a decision-method label. */
export const isDecisionWork = (item: Item): boolean =>
    item.kind === 'decision' ||
    (item.recorded !== true && ['grill', 'prototype', 'research', 'task'].includes(decisionType(item) ?? ''));

/** Each start's verb: Shape, Build, Build all for a concept's builds, Decide for a decision. */
const SHORT = { shaping: 'Shape', build: 'Build', 'concept builds': 'Build all', decision: 'Decide' } as const;

/**
 * The open blocker a deferred start names, the last one when several are open, short enough for a button: `#n` (or
 * `repo#n` in another repository) when it has a ticket, `Part n` when it is a numbered part among `items`, else null.
 */
export function startAfterRef(item: Pick<Item, 'blockers' | 'repo'>, items: readonly Item[] = []): string | null {
    const blocker = openBlockers(item).at(-1);

    if (!blocker || blocker.dependency) return null;

    if (blocker.number) return blockerRef(item, blocker, true);

    const order = blocker.workId ? items.find((other) => other.id === blocker.workId)?.partOrder : undefined;

    return order ? `Part ${order}` : null;
}

/**
 * One action name for every item, part, map node and dialog that starts work. A deferred start names its prerequisite
 * as startAfterRef gives it, or, with none (`null`), says it starts when unblocked; the full name is its tooltip's.
 */
export function startActionChoice(
    item: Item,
    kind: 'refine' | 'build' = item.status === 'Ready' ? 'build' : 'refine',
    after?: { prerequisite: string | null; armed: boolean },
) {
    const work =
        kind === 'build'
            ? item.kind === 'concept'
                ? 'concept builds'
                : 'build'
            : isDecisionWork(item)
              ? 'decision'
              : 'shaping';
    // One short verb names the start, as the lane already says what kind of work it is.
    const verb = kind === 'refine' && canResumeShaping(item) ? 'Resume' : SHORT[work as keyof typeof SHORT];

    return {
        kind,
        label: after
            ? `${after.armed ? 'Starts' : 'Start'} ${after.prerequisite ? `after ${after.prerequisite}` : 'when unblocked'}`
            : verb,
    };
}
