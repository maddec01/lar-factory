import { isDecisionWork } from '@lar-factory/shared';
// Delivery and decision workflows share the presenter, with steps appropriate to their kind.
import type { Item } from '@lar-factory/shared';

const WORKFLOW_STEPS = ['Queue', 'Shaping', 'Ready to build', 'Build', 'Review', 'Verify', 'Merge'] as const;

const DECISION_STEPS = ['Queue', 'Working', 'Outcome'] as const;

export const workflowSteps = (item: Item): readonly string[] =>
    isDecisionWork(item)
        ? DECISION_STEPS
        : item.verification?.prReview
          ? WORKFLOW_STEPS.map((step) => (step === 'Verify' ? 'Review PR' : step))
          : WORKFLOW_STEPS;

/** A step's name on a card's mini track: a decision's "Working" step reads "Deciding", so a step is never mistaken for
 *  the state beside it. */
export const stepName = (step: string): string => (step === 'Working' ? 'Deciding' : step);
