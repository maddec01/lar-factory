import { mergeStageProblem, type Item, type MergeConfirmation } from '@lar-factory/shared';
import { Alert, Button, ConfirmDialog, Loading, Stack } from '@lar-works/design-system';
import { useEffect, useState, type ReactNode } from 'react';

import { useActionStore, useItemAction } from './ActionStore';
import { ICON } from './ButtonIcons';
import { useActivityUnavailable } from './useActivityFeedback';
import { useBoardStore } from '@/services/board/board.hooks';
import type { ActionResult } from '@/services/board/board.service';
import { postAction, receive } from '@/services/board/board.service';
import { useButtonKind } from '@/ui/board';

/** A fallback merge in item details, using the repository default method. */
export function MergePr({
    item,
    label,
    primary,
    next,
    openPr,
}: {
    item: Item;
    label: string;
    primary: boolean;
    next: boolean;
    openPr: ReactNode;
}) {
    const kindOf = useButtonKind();
    const [open, setOpen] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [inspected, setInspected] = useState<{
        request: string;
        result: ActionResult & { confirmation?: MergeConfirmation };
    }>();
    const [mergeError, setMergeError] = useState<string>();
    const [consumedAttempt, setConsumedAttempt] = useState<number>();
    const action = useItemAction(item.id);
    const pending = action?.phase === 'pending';
    const activityLost = useActivityUnavailable();
    const disconnected = useBoardStore(
        (s) => s.clientError || s.data.itemSourceProblems?.some((p) => p.repo === item.repo),
    );
    const problem = activityLost
        ? 'Current build activity is unavailable. Refresh before merging.'
        : mergeStageProblem(item);
    const identity = JSON.stringify([item.linkedPrs[0]?.url, item.linkedPrs[0]?.sourceRevision]);

    const request = JSON.stringify([item.id, identity, attempt, problem, !!disconnected]);
    const stale = inspected?.request !== request;
    const reading = open && !problem && !disconnected && stale;
    const confirmation = !stale && consumedAttempt !== attempt ? inspected?.result.confirmation : undefined;
    const error =
        problem ??
        (disconnected
            ? 'The provider is disconnected. Refresh before merging.'
            : (mergeError ?? (!stale ? inspected?.result.error : undefined)));

    useEffect(() => {
        if (!open || problem || disconnected) return;

        const controller = new AbortController();

        void postAction<{ confirmation: MergeConfirmation; merged: boolean }>('/api/inspect-merge', {
            itemId: item.id,
        }).then((result) => {
            if (controller.signal.aborted) return;

            setInspected({ request, result });

            if (result.merged) {
                receive(result);
                setOpen(false);
            }
        });

        return () => {
            controller.abort();
        };
    }, [open, item.id, request, problem, disconnected]);

    const confirm = async () => {
        if (!confirmation || pending || reading || problem || disconnected) return;

        const actions = useActionStore.getState();

        if (actions.actions[item.id]?.phase === 'pending') return;

        actions.set(item.id, { phase: 'pending', kind: 'merge-pr' });

        const result = await postAction<{ merged: boolean }>('/api/merge-pr', {
            itemId: item.id,
            token: confirmation.token,
        });

        receive(result);
        actions.set(item.id, result.error ? { phase: 'error', kind: 'merge-pr', message: result.error } : undefined);
        setConsumedAttempt(attempt);
        setMergeError(
            result.error ??
                (result.merged ? undefined : 'Merge outcome is unknown. Refresh readiness before trying again.'),
        );

        if (result.merged) setOpen(false);
    };

    return (
        <>
            {/* Off the dialog's footer it reads as the other pull request actions: an outline with the PR icon. */}
            <Button
                {...kindOf(primary ? 'main' : next ? 'next' : 'open')}
                leftIcon={primary ? undefined : ICON.pr}
                disabled={pending}
                onClick={() => {
                    setAttempt((n) => n + 1);
                    setMergeError(undefined);
                    setOpen(true);
                }}
            >
                {label}
            </Button>
            {open && (
                <ConfirmDialog
                    id="merge-pr-dialog"
                    title={`Merge PR #${confirmation?.number ?? item.linkedPrs[0]?.number}?`}
                    consequence={
                        confirmation
                            ? `Merge ${confirmation.url} at source revision ${confirmation.sourceRevision}.`
                            : 'Check the recorded delivery PR before confirming its merge.'
                    }
                    intent="default"
                    confirmLabel="Merge PR"
                    confirmDisabled={!confirmation || reading || !!problem || !!disconnected}
                    busy={pending}
                    onCancel={() => setOpen(false)}
                    onConfirm={() => void confirm()}
                    secondaryAction={openPr}
                >
                    <Stack space="related">
                        {reading && (
                            <Loading presentation="status" label="Loading current permissions and merge policies…" />
                        )}
                        {error && <Alert tone="danger">{error}</Alert>}
                        {!reading && !confirmation && (
                            <Button
                                {...kindOf('other')}
                                disabled={pending}
                                onClick={() => {
                                    setMergeError(undefined);
                                    setAttempt((n) => n + 1);
                                }}
                            >
                                Refresh readiness
                            </Button>
                        )}
                    </Stack>
                </ConfirmDialog>
            )}
        </>
    );
}
