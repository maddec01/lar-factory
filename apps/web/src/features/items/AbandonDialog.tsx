// Abandon keeps provider failures in the confirmation so work can still be set aside locally. On a notice's work it also
// offers cleanup, which runs first, so a failed step leaves the item, its notice and its ticket as they were.

import {
    ABANDON_CLEANUP,
    abandonPrompt,
    abandonsNotice,
    closeTicketPrompt,
    closesTicketOnAbandon,
    hasClosedPr,
} from '@lar-factory/shared';
import { Alert, Button, ConfirmDialog, Stack, Text } from '@lar-works/design-system';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { useAbandonStore } from './AbandonStore';
import { abandonItem, closeTicket } from './CardActions';
import { CleanupChoices } from './CleanupChoices';
import { executeCleanup, inspectCleanup, useCleanupChoices } from './useCleanupChoices';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

/** The cleanup of the notice's work `itemId` names while its confirmation is open: null for any other Abandon. */
function useNoticeCleanup(itemId: string | null) {
    const choices = useCleanupChoices();
    const [inspected, setInspected] = useState(false);
    const [uninspected, setUninspected] = useState<string | null>(null);
    const [failure, setFailure] = useState<{ message: string; combined: boolean } | null>(null);
    // Only the newest inspection answers, as the server keeps only its token.
    const latest = useRef(0);

    async function inspect(id: string, keep = false) {
        const run = ++latest.current;

        setInspected(false);
        setFailure(null);

        const result = await inspectCleanup(id);

        if (run !== latest.current) return;

        if (result.error || !result.token || !result.plans) setUninspected(result.error ?? 'It gave no answer.');
        else choices.offer({ token: result.token, plans: result.plans }, keep);

        setInspected(true);
    }

    // StrictMode starts an effect twice, and one read answers for both.
    const opened = useRef<string | null>(null);

    const inspectOpened = useEffectEvent(() => {
        if (opened.current === itemId) return;

        opened.current = itemId;
        latest.current++;
        choices.reset();
        setUninspected(null);
        setFailure(null);
        setInspected(false);

        // oxlint-disable-next-line react/set-state-in-effect -- a new item's inspection clears the last one's answer as it starts
        if (itemId) void inspect(itemId);
    });

    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect -- a new item resets its cleanup inspection before the read starts
        inspectOpened();
    }, [itemId]);

    return {
        choices,
        uninspected,
        failure,
        checking: !!itemId && !inspected,
        retry: () => {
            if (itemId) void inspect(itemId, true);
        },
        skip: () => {
            choices.drop();
            setFailure(null);
        },
        /** Runs the ticked steps once: whether Abandon may go on. Execution uses up the token, so a retry inspects again. */
        async run(id: string, combined: boolean): Promise<boolean> {
            if (!choices.cleanup || (!choices.local && !choices.remote)) return true;

            const cleaned = await executeCleanup(id, choices.selection());

            choices.drop();

            const message = cleaned.error ?? cleaned.errors?.join(' ');

            if (message) setFailure({ message, combined });

            return !message;
        },
    };
}

export function AbandonDialog() {
    const { open, item: asked, step, close } = useAbandonStore();
    const shown = useBoardStore((state) => state.data.items.find((i) => i.id === asked?.id));
    // The asked item keeps the question steady, but a ticket the board has since read closed is no longer one to close.
    const item =
        asked?.needsYou && shown?.needsYou
            ? { ...asked, needsYou: { ...asked.needsYou, ticketOpen: shown.needsYou.ticketOpen } }
            : asked;
    const notice = useNoticeCleanup(open && item && step === 'abandon' && abandonsNotice(item) ? item.id : null);
    const submitting = useRef(false);
    const ticketClosed = useRef(false);
    const [pending, setPending] = useState(false);
    const [unknown, setUnknown] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open || !item) return null;

    const closing = step === 'close-ticket';
    const prompt = closing ? closeTicketPrompt(item) : abandonPrompt(item);
    const dismiss = () => {
        if (!submitting.current && !unknown) {
            setError(null);
            ticketClosed.current = false;
            close();
        }
    };
    const confirm = async (combined = false, withoutCleanup = false) => {
        if (submitting.current) return;

        if (!withoutCleanup && notice.choices.asksLoss()) return;

        submitting.current = true;
        setPending(true);
        setError(null);

        if (closing) {
            await closeTicket(item);
            setPending(false);
            submitting.current = false;
            close();

            return;
        }

        if (withoutCleanup) notice.skip();
        else if (!(await notice.run(item.id, combined))) {
            setPending(false);
            submitting.current = false;

            return;
        }

        if (!combined) {
            if (unknown) {
                setPending(false);
                submitting.current = false;

                return;
            }

            const result = await abandonItem(item.id);

            setPending(false);
            submitting.current = false;

            if (result?.error)
                setError(
                    ticketClosed.current
                        ? `The ticket is closed, but the work remains on the board. ${result.error}`
                        : result.error,
                );
            else if (result) {
                ticketClosed.current = false;
                close();
            }

            return;
        }

        let result = await postAction('/api/abandon-and-close', { itemId: item.id });

        if (result.error === 'Can’t reach the board server. Try again.') {
            result = await postAction('/api/abandon-and-close', { itemId: item.id });

            if (result.error === 'Can’t reach the board server. Try again.')
                result.error =
                    'The outcome is unknown. Restore the connection and try again to reconcile the work and ticket.';
        }

        if (result.error?.startsWith('The ticket is closed, but the work remains on the board.'))
            ticketClosed.current = true;

        setUnknown(
            result.error ===
                'The outcome is unknown. Restore the connection and try again to reconcile the work and ticket.',
        );
        receive(result);
        setPending(false);
        submitting.current = false;

        if (result.error) setError(result.error);
        else {
            setError(null);
            ticketClosed.current = false;
            close();
        }
    };
    const loss = notice.choices.confirmLoss;
    const failedCombined = !!notice.failure?.combined && closesTicketOnAbandon(item);

    const confirmLabel = notice.failure
        ? failedCombined
            ? 'Abandon and close ticket without further cleanup'
            : 'Abandon without further cleanup'
        : loss
          ? 'Confirm loss and abandon'
          : notice.uninspected
            ? 'Abandon without cleanup'
            : prompt.confirm;

    return (
        <ConfirmDialog
            id="abandon-dialog"
            data-abandon-step={step}
            title={prompt.question}
            consequence={prompt.detail}
            confirmLabel={confirmLabel}
            cancelLabel={closing ? closeTicketPrompt(item).keep : 'Cancel'}
            busy={pending}
            confirmDisabled={unknown || notice.checking}
            cancelDisabled={unknown}
            onCancel={dismiss}
            onConfirm={() => void confirm(notice.failure ? failedCombined : false, !!notice.failure)}
            secondaryAction={
                notice.failure ? (
                    <Button {...buttonKind('other')} disabled={pending} onClick={notice.retry}>
                        Try cleanup again
                    </Button>
                ) : !closing && closesTicketOnAbandon(item) ? (
                    <Button
                        {...buttonKind('other')}
                        wrap
                        disabled={pending || notice.checking}
                        onClick={() => void confirm(true)}
                    >
                        {error
                            ? 'Try again'
                            : loss
                              ? 'Confirm loss, abandon and close ticket'
                              : notice.uninspected
                                ? 'Abandon and close ticket without cleanup'
                                : 'Abandon and close ticket'}
                    </Button>
                ) : undefined
            }
        >
            <Stack space="related">
                {item.abandonRefusal && <Text>{item.abandonRefusal}</Text>}
                {notice.checking && <Text role="status">Checking the branch and worktree…</Text>}
                {notice.uninspected && <Alert tone="warning">{ABANDON_CLEANUP.uninspected(notice.uninspected)}</Alert>}
                <CleanupChoices
                    choices={notice.choices}
                    remoteNote={hasClosedPr(item) && <Text>{ABANDON_CLEANUP.remoteWarning}</Text>}
                />
                {notice.failure && (
                    <Alert tone="danger">
                        {ABANDON_CLEANUP.failed(item)} {notice.failure.message}
                    </Alert>
                )}
                {error && <Alert tone="danger">{error}</Alert>}
            </Stack>
        </ConfirmDialog>
    );
}
