import { isDecisionWork } from '@lar-factory/shared';
// Delivery and decision workflows share the presenter, with steps appropriate to their kind.
import type { Item } from '@lar-factory/shared';

const WORKFLOW_STEPS = ['Queue', 'Shaping', 'Ready to build', 'Build', 'Review', 'Verify', 'Merge'] as const;

const DECISION_STEPS = ['Queue', 'Working', 'Outcome'] as const;

export const workflowSteps = (item: Item): readonly string[] =>
    isDecisionWork(item) ? DECISION_STEPS : WORKFLOW_STEPS;
