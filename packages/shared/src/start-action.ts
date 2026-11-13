import { decisionType } from './board-domain.ts';
import type { Item } from './item-domain.ts';
import { canResumeShaping } from './thread-domain.ts';

/** Local kinds win; legacy unrecorded tickets may still carry a decision-method label. */
export const isDecisionWork = (item: Item): boolean =>
    item.kind === 'decision' ||
    (item.recorded !== true && ['grill', 'prototype', 'research', 'task'].includes(decisionType(item) ?? ''));

/** One action name for every item, part, map node and dialog that starts work. */
export function startActionChoice(
    item: Item,
    kind: 'refine' | 'build' = item.status === 'Ready' ? 'build' : 'refine',
    after?: { prerequisite: string; armed: boolean },
) {
    const work =
        kind === 'build'
            ? item.kind === 'concept'
                ? 'concept builds'
                : 'build'
            : isDecisionWork(item)
              ? 'decision'
              : 'shaping';
    const verb = kind === 'refine' && canResumeShaping(item) ? 'Resume' : 'Start';

    return {
        kind,
        label: after ? `${after.armed ? 'Starts' : 'Start'} ${work} after ${after.prerequisite}` : `${verb} ${work}`,
    };
}
