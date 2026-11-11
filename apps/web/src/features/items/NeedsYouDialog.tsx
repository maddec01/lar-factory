// A Needs you choice's confirmation: what it will do, the recovery and cleanup choices it needs, and any failure, which
// stays here to retry or cancel. Opening it only reads; a write waits for a press inside it.

import type { BoardData, Item, NeedsYouAction } from '@lar-factory/shared';
import { needsYouPrompt } from '@lar-factory/shared';
import { Alert, Button, DropdownMenu, ConfirmDialog, Modal, Stack, Text } from '@lar-works/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { writeState } from './ActionAvailability';
import { useActionStore, useItemAction } from './ActionStore';
import type { RecoveryInspection } from './CardActions';
import { inspectRecovery, resolveNeedsYou, startAgain } from './CardActions';
import { CleanupChoices } from './CleanupChoices';
import { StartEntries } from './StartControl';
import { executeCleanup, inspectCleanup, offersCleanup, useCleanupChoices } from './useCleanupChoices';
import type { ActionResult } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

interface Props {
    item: Item;
    data: BoardData;
    offer: NeedsYouAction;
    label: string;
    onClose: () => void;
}

export function NeedsYouDialog({ item, data, offer, label, onClose }: Props) {
    const prompt = needsYouPrompt(item, offer);
    const state = writeState(data, useItemAction(item.id));
    const inspects = offer === 'start-again' && item.needsYou?.startAgainPurpose === 'build';
    const moving = offer === 'back-to-queue' || offer === 'back-to-list';
    const [inspection, setInspection] = useState<RecoveryInspection | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const cleanupChoices = useCleanupChoices();
    const [next, setNext] = useState<(() => Promise<ActionResult | undefined>) | null>(null);
    const { cleanup } = cleanupChoices;
    const checking = inspects && !inspection && !error;
    const held = state.disabled || loading;
    const dismiss = () => {
        if (!loading) onClose();
    };

    const inspect = useCallback(async () => {
        setError(null);

        const result = await inspectRecovery(item.id);

        if (result.error || !result.inspection) setError(result.error ?? 'Can’t inspect recovery.');
        else setInspection(result.inspection);
    }, [item.id]);

    // StrictMode starts an effect twice, and one read answers for both.
    const inspected = useRef(false);

    useEffect(() => {
        if (!inspects || inspected.current) return;

        inspected.current = true;
        void inspect();
    }, [inspects, inspect]);

    async function finish(
        run: () => Promise<ActionResult | undefined>,
        selection?: ReturnType<typeof cleanupChoices.selection>,
    ) {
        setLoading(true);
        setError(null);

        try {
            const result = await run();

            if (!result) return;

            if (result.error || ('uncertain' in result && result.uncertain)) {
                setError(result.error);

                return;
            }

            if (selection) {
                const cleaned = await executeCleanup(item.id, selection);
                const message =
                    [
                        cleaned.error,
                        ...(cleaned.errors ?? []),
                        cleaned.remainingBranches?.length
                            ? `Branches remain for you to remove: ${cleaned.remainingBranches.join(', ')}`
                            : null,
                    ]
                        .filter(Boolean)
                        .join(' ') || undefined;

                useActionStore.getState().setCleanupResult(item.id, message);
            }

            onClose();
        } finally {
            setLoading(false);
        }
    }

    async function prepare(run: () => Promise<ActionResult | undefined>) {
        useActionStore.getState().setCleanupResult(item.id, undefined);
        setLoading(true);
        setError(null);

        const result = await inspectCleanup(item.id);

        setLoading(false);

        if (result.error || !result.token || !result.plans) {
            setError(result.error ?? 'Can’t inspect cleanup.');

            return;
        }

        if (!offersCleanup(result.plans)) {
            await finish(run);

            return;
        }

        cleanupChoices.offer({ token: result.token, plans: result.plans });
        setNext(() => run);
    }

    const confirm = () => {
        if (moving) void prepare(() => resolveNeedsYou(item.id, offer));
        else if (inspection) void prepare(() => startAgain(item.id, { branchChoice: 'new' }));
        else if (offer === 'start-again') void finish(() => startAgain(item.id, {}));
        else void finish(() => resolveNeedsYou(item.id, offer));
    };
    const confirmButton = (name: string, press: () => void) => (
        <Button {...buttonKind('main', { size: 'md' })} {...state} key={name} disabled={held} onClick={press}>
            {name}
        </Button>
    );

    const choices = !inspection
        ? []
        : inspection.pr === 'open'
          ? (['continue'] as const)
          : inspection.branchExists
            ? (['continue', 'new'] as const)
            : (['new'] as const);
    const actions = () => {
        if (cleanup && next)
            return confirmButton(cleanupChoices.confirmLoss ? 'Confirm loss and proceed' : 'Proceed', () => {
                if (!cleanupChoices.asksLoss()) void finish(next, cleanupChoices.selection());
            });

        if (inspects && !inspection) return error ? confirmButton('Try again', () => void inspect()) : null;

        if (inspection && (inspection.branchExists || inspection.pr !== 'none'))
            return choices.map((branchChoice) => (
                <DropdownMenu key={branchChoice}>
                    <DropdownMenu.Trigger asChild>
                        <Button {...buttonKind('main', { size: 'md' })} {...state} disabled={held}>
                            {branchChoice === 'continue' ? 'Continue on old branch' : 'Start on new branch'}
                        </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                        <StartEntries
                            requireModel={branchChoice === 'continue' && !!inspection.worktreePath}
                            item={item}
                            data={data}
                            onPick={(model) => {
                                const run = () =>
                                    startAgain(
                                        item.id,
                                        { branchChoice, confirmedOpenPr: inspection.pr === 'open' },
                                        model,
                                    );

                                void (branchChoice === 'new' ? prepare(run) : finish(run));
                            }}
                        />
                    </DropdownMenu.Content>
                </DropdownMenu>
            ));

        if (moving && item.passingBrief)
            return (['keep', 'reshape'] as const).map((briefChoice) =>
                confirmButton(
                    briefChoice === 'keep' ? 'Keep passing' : 'Reshape',
                    () => void prepare(() => resolveNeedsYou(item.id, offer, briefChoice)),
                ),
            );

        return confirmButton(loading ? 'Working…' : error ? 'Try again' : label, confirm);
    };

    if (cleanup && next)
        return (
            <ConfirmDialog
                id="needs-you-dialog"
                title={prompt.question}
                consequence={prompt.detail}
                confirmLabel={cleanupChoices.confirmLoss ? 'Confirm loss and proceed' : 'Proceed'}
                busy={loading}
                confirmDisabled={held}
                onCancel={dismiss}
                onConfirm={() => {
                    if (!cleanupChoices.asksLoss()) void finish(next, cleanupChoices.selection());
                }}
            >
                <CleanupChoices choices={cleanupChoices} />
                {error && <Alert tone="danger">{error}</Alert>}
            </ConfirmDialog>
        );

    return (
        <Modal onClose={dismiss}>
            {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
            <Modal.Content
                id="needs-you-dialog"
                role="alertdialog"
                title={prompt.question}
                description="Nothing changes until you confirm."
                aria-describedby="needs-you-detail"
                closeOnOverlayClick={false}
            >
                <Modal.Body>
                    <Stack space="related">
                        <Text id="needs-you-detail" tone="muted">
                            {prompt.detail}
                        </Text>
                        {checking && <Text role="status">Checking the branch and PR...</Text>}
                        {inspection && !cleanup && (
                            <>
                                {inspection.warning && (
                                    <Alert tone="warning">
                                        PR state is unknown. A new branch or move could create a second PR. Deleting the
                                        remote branch could close an open PR.
                                    </Alert>
                                )}
                                {inspection.branchExists && (
                                    <Text>
                                        {inspection.worktreePath
                                            ? 'Continue in the old worktree with its uncommitted changes.'
                                            : 'The old worktree is gone. Continuing creates a new worktree on the old branch.'}
                                    </Text>
                                )}
                                {inspection.pr !== 'open' && (
                                    <Text>
                                        A new branch starts from the base branch and plans the build again from its
                                        brief.
                                    </Text>
                                )}
                                {inspection.pr === 'open' && (
                                    <Text>
                                        A new thread continues on the open PR branch. Its commits and reviews stay, and
                                        the PR stays open.
                                    </Text>
                                )}
                            </>
                        )}
                        {moving && item.passingBrief && !cleanup && (
                            <Text>Keep the brief passing or reshape from its text?</Text>
                        )}
                        {cleanup && next && <CleanupChoices choices={cleanupChoices} />}
                        {error && <Alert tone="danger">{error}</Alert>}
                    </Stack>
                </Modal.Body>
                <Modal.Footer>
                    <Button {...buttonKind('other', { size: 'md' })} disabled={loading} onClick={dismiss}>
                        Cancel
                    </Button>
                    {actions()}
                </Modal.Footer>
            </Modal.Content>
        </Modal>
    );
}
