import { needsAnswer } from './board-view.ts';
import { openQuestionThread, prReadiness, type Item } from './model.ts';

/** The next step shared by the desk and item dialog, derived from current PR evidence. */
export function nextAction(item: Item): { kind: 'thread' | 'pr'; label: string; threadId?: string | undefined } | null {
    if (needsAnswer(item)) {
        const question = openQuestionThread(item);

        return { kind: 'thread', label: question ? 'Answer in T3' : 'Open thread', threadId: question?.id };
    }

    const readiness = prReadiness(item);

    if (readiness) return { kind: 'pr', label: readiness.action };

    if (item.status === 'Verify') return { kind: 'pr', label: 'Verify build' };

    if (item.status === 'Ready to merge') return { kind: 'pr', label: 'Merge PR' };

    return null;
}
