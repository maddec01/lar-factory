// Queue, Move to List, Keep, Abandon and the ticket close after it, Needs you's choices and a Dependency's met mark, from the item dialog: each posts to the board server, shows the result, and keeps
// keyboard focus in the dialog.

import { abandonsNotice, remembersChoice } from '@lar-factory/shared';
import type { Item, NeedsYouAction, ModelChoice, StartResult } from '@lar-factory/shared';
import { flushSync } from 'react-dom';

import { useAbandonStore } from './AbandonStore';
import { useActionStore } from './ActionStore';
import type { ItemAction } from './ActionStore';
import { useStartStore } from './StartStore';
import { OPEN_ITEM_DIALOG, useItemDialogStore } from '@/features/item-dialog/ItemDialogStore';
import { notify } from '@/features/notices/Notices';
import { refocus } from '@/features/notices/Toasts';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import type { ActionResult } from '@/services/board/board.service';

const by = (attr: string, value: string) => `[${attr}="${CSS.escape(value)}"]`;

const pending = (itemId: string) => useActionStore.getState().actions[itemId]?.phase === 'pending';
const itemOf = (itemId: string) => useBoardStore.getState().data.items.find((i) => i.id === itemId);

/** Whether the item's `attr` button is in the open item dialog and the item has no action in flight. */
const ready = (itemId: string, attr: string) =>
    Boolean(document.querySelector(`${OPEN_ITEM_DIALOG} ${by(attr, itemId)}`)) && !pending(itemId);

/**
 * Marks the item pending, posts `body` to `/api/<kind>`, then in one render shows the board the server sent and runs
 * `show`, which returns the error to keep on the item, if any.
 */
async function runAction(
    itemId: string,
    kind: ItemAction['kind'],
    body: object,
    show: (result: ActionResult) => string | undefined,
): Promise<ActionResult> {
    const actions = useActionStore.getState();

    actions.set(itemId, { phase: 'pending', kind });

    const result = await postAction(`/api/${kind}`, body);

    flushSync(() => {
        receive(result);

        const message = show(result);

        actions.set(itemId, message === undefined ? undefined : { phase: 'error', kind, message });
    });

    return result;
}

export async function queueItem(itemId: string): Promise<void> {
    if (!ready(itemId, 'data-queue')) return;

    const origin = useItemDialogStore.getState();
    const result = await runAction(itemId, 'queue', { itemId }, (result) => {
        const currentId = result.itemId ?? itemId;
        const item = itemOf(currentId);

        if (result.error || !item) return result.error ?? 'The item left the board.';

        const dialog = useItemDialogStore.getState();

        if (dialog.session !== origin.session || dialog.itemId !== itemId) return;

        if (currentId !== itemId) useItemDialogStore.setState({ itemId: currentId });

        if (origin.fromList) dialog.dismiss?.();
    });

    // The item stays on show, Queued, so focus goes to its Start.
    if (
        !result.error &&
        !origin.fromList &&
        useItemDialogStore.getState().session === origin.session &&
        useItemDialogStore.getState().itemId !== null
    )
        refocus([by('data-start', result.itemId ?? itemId), by('data-back-to-list', result.itemId ?? itemId)]);
}

export async function backToList(itemId: string): Promise<void> {
    const item = itemOf(itemId);

    if (!ready(itemId, 'data-back-to-list') || !item) return;

    // A failure is a toast only: the dialog's footer goes back to its links.
    const result = await runAction(itemId, 'back-to-list', { itemId }, (result) => {
        notify(
            result.error
                ? { verb: 'Failed', item, to: 'List', message: result.error }
                : { verb: 'Moved', item, to: 'List' },
        );
    });

    refocus([by(result.error ? 'data-back-to-list' : 'data-queue', itemId)]);
}

/** Opens Abandon's confirm dialog for the item. */
export function askAbandon(itemId: string): void {
    const item = itemOf(itemId);

    if (item && !pending(itemId)) useAbandonStore.getState().ask(item);
}

export async function abandonItem(itemId: string) {
    const item = itemOf(itemId);

    if (!ready(itemId, 'data-abandon') || !item) return;

    // The confirmation retains failures until the user retries or cancels. On a notice's work it has choices a toast
    // would cover, so its failure raises none; List and Queued work keeps the toast.
    const result = await runAction(
        itemId,
        'abandon',
        { session: useBoardStore.getState().data.capture?.session, itemId },
        (result) => {
            if (!result.error) notify({ verb: 'Abandoned', item });
            else if (!abandonsNotice(item)) notify({ verb: 'Failed', item, message: result.error });
        },
    );

    // An abandoned item leaves the item dialog, which closes and hands focus back itself.
    if (result.error) refocus([by('data-abandon', itemId)]);

    return result;
}

/** Closes the ticket of work set aside in Archive. */
export async function closeTicket(item: Item): Promise<void> {
    const result = await postAction('/api/close-ticket', { itemId: item.id });

    flushSync(() => {
        receive(result);
        notify(result.error ? { verb: 'Failed', item, ticket: true, message: result.error } : { verb: 'Closed', item });
    });
}

/** Acts on work that needs you as `choice` says; its confirmation shows a failure, so the item keeps none. */
export async function resolveNeedsYou(
    itemId: string,
    choice: NeedsYouAction,
    briefChoice?: 'keep' | 'reshape',
): Promise<ActionResult | undefined> {
    if (!ready(itemId, 'data-needs-you')) return;

    return runAction(itemId, 'needs-you', { itemId, choice, briefChoice }, () => undefined);
}

/** Marks the Dependency holding the item met, or clears the mark; a failure stays in the dialog. */
export async function markDependencyMet(
    itemId: string,
    dependencyId: string,
    revision: number,
    met: boolean,
): Promise<void> {
    if (!ready(itemId, 'data-dependency-met')) return;

    await runAction(
        itemId,
        'dependency-met',
        { itemId, dependencyId, revision, met },
        (result) => result.error ?? undefined,
    );
}

export interface RecoveryInspection {
    branch: string;
    branchExists: boolean;
    worktreePath: string | null;
    pr: 'open' | 'none' | 'unknown';
    warning?: string;
}

export async function inspectRecovery(itemId: string) {
    return postAction<{ inspection: RecoveryInspection }>('/api/inspect-recovery', { itemId });
}

export async function startAgain(
    itemId: string,
    options: { branchChoice?: 'continue' | 'new'; confirmedOpenPr?: boolean },
    model?: ModelChoice,
) {
    const actions = useActionStore.getState();

    if (pending(itemId)) return;

    actions.set(itemId, { phase: 'pending', kind: 'needs-you' });

    const result = await postAction<StartResult>('/api/start-again', { itemId, options, model });

    flushSync(() => {
        receive(result);

        if (remembersChoice(result)) useStartStore.getState().remember(model);

        actions.set(itemId, undefined);
    });

    return result;
}
