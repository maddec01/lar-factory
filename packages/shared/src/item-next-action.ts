import { needsAnswer } from './board-view.ts';
import { openQuestionThread, prReadiness, workingAgain, currentBuildThread, type Item } from './model.ts';
import { questionThreadAction } from './question-thread.ts';

/** The next step shared by the desk and item dialog, derived from current PR evidence. */
export function nextAction(item: Item): { kind: 'thread' | 'pr'; label: string; threadId?: string | undefined } | null {
    if (item.briefReviewing && !needsAnswer(item)) return null;

    if (needsAnswer(item)) return questionThreadAction(openQuestionThread(item));

    if (workingAgain(item)) return { kind: 'thread', label: 'Open thread', threadId: currentBuildThread(item)?.id };

    const readiness = prReadiness(item);

    if (readiness) return { kind: 'pr', label: readiness.action };

    if (item.status === 'Verify') return { kind: 'pr', label: 'Verify build' };

    if (item.status === 'Ready to merge') return { kind: 'pr', label: 'Merge PR' };

    return null;
}
