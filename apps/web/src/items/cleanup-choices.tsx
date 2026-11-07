// A confirmation's choice to remove work's old branches and worktrees, and to confirm losing what they hold. Inspecting
// only reads; the board changes nothing until the confirmation executes the ticked steps.

import { ABANDON_CLEANUP } from '@lar-factory/shared';
import { Alert, Text } from '@lar-works/design-system';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { postAction, receive } from './card-actions.ts';

interface CleanupPlan {
    branch: string;
    localBranches?: string[];
    worktreePaths?: string[];
    remoteBranch?: string | null;
    localAvailable: boolean;
    remoteAvailable: boolean;
    dirtyFiles: string[];
    unpushedCommits: string[];
    warning?: string;
}

interface Inspected {
    token: string;
    plans: CleanupPlan[];
}

export const inspectCleanup = (itemId: string) => postAction<Inspected>('/api/inspect-owned-cleanup', { itemId });

export async function executeCleanup(
    itemId: string,
    options: { token: string; local: boolean; remote: boolean; confirmedLoss: boolean },
) {
    const cleaned = await postAction<{ errors: string[]; remainingBranches: string[] }>('/api/execute-owned-cleanup', {
        itemId,
        options,
    });

    receive(cleaned);

    return cleaned;
}

/** Whether the plans name any branch or worktree to ask about. */
export const offersCleanup = (plans: CleanupPlan[]) =>
    plans.some(
        (plan) =>
            plan.localAvailable ||
            plan.remoteAvailable ||
            plan.warning ||
            plan.localBranches?.length ||
            plan.worktreePaths?.length ||
            plan.remoteBranch,
    );

export function useCleanupChoices() {
    const [cleanup, setCleanup] = useState<Inspected | null>(null);
    const [local, setLocal] = useState(false);
    const [remote, setRemote] = useState(false);
    const [confirmLoss, setConfirmLoss] = useState(false);

    return {
        cleanup,
        local,
        remote,
        confirmLoss,
        setRemote,
        setLocal: (ticked: boolean) => {
            setLocal(ticked);
            setConfirmLoss(false);
        },
        /** Asks about a fresh inspection, unticked unless a retry `keep`s what it can still do. Any loss asks again. */
        offer: (inspected: Inspected, keep = false) => {
            setLocal(keep && local && inspected.plans.some((plan) => plan.localAvailable));
            setRemote(keep && remote && inspected.plans.some((plan) => plan.remoteAvailable));
            setConfirmLoss(false);
            setCleanup(inspected);
        },
        /** Forgets the inspection but keeps the ticks, which a retry's `offer` can `keep`. */
        drop: () => {
            setCleanup(null);
            setConfirmLoss(false);
        },
        /** Forgets everything, for a confirmation that opens anew. */
        reset: () => {
            setCleanup(null);
            setLocal(false);
            setRemote(false);
            setConfirmLoss(false);
        },
        /** Whether this press only shows what local removal would lose, which a second press confirms. */
        asksLoss: () => {
            if (
                !local ||
                confirmLoss ||
                !cleanup?.plans.some((plan) => plan.dirtyFiles.length || plan.unpushedCommits.length)
            )
                return false;

            setConfirmLoss(true);

            return true;
        },
        selection: () => ({ token: cleanup!.token, local, remote, confirmedLoss: confirmLoss }),
    };
}

/** The loss list can open below the dialog body's scroll edge while its confirming button already shows. jsdom may lack scrollIntoView. */
const scrollIn = (list: HTMLElement | null) => {
    list?.scrollIntoView?.({ block: 'nearest' });
};

export function CleanupChoices({
    choices,
    remoteNote,
}: {
    choices: ReturnType<typeof useCleanupChoices>;
    remoteNote?: ReactNode;
}) {
    const { cleanup, local, remote, confirmLoss } = choices;

    if (!cleanup) return null;

    const remoteBranches = cleanup.plans
        .filter((plan) => plan.remoteAvailable)
        .map((plan) => plan.remoteBranch ?? plan.branch);
    const remoteOffered = remoteBranches.length > 0;
    const localBranches = cleanup.plans
        .filter((plan) => plan.localAvailable)
        .flatMap((plan) => plan.localBranches ?? [plan.branch]);

    return (
        <>
            {cleanup.plans.map(
                (plan) =>
                    plan.warning && (
                        <Alert tone="warning" key={plan.branch}>
                            {plan.warning}
                        </Alert>
                    ),
            )}
            {localBranches.length > 0 && (
                <label className="wrap-anywhere">
                    <input
                        type="checkbox"
                        checked={local}
                        onChange={(event) => choices.setLocal(event.target.checked)}
                    />{' '}
                    Remove old local worktrees and branches: {localBranches.join(', ')}
                </label>
            )}
            {remoteOffered && (
                <label className="wrap-anywhere">
                    <input
                        type="checkbox"
                        checked={remote}
                        onChange={(event) => choices.setRemote(event.target.checked)}
                    />{' '}
                    Delete pushed remote branch: {remoteBranches.join(', ')}
                </label>
            )}
            {remoteOffered && remoteNote}
            <Text>
                {localBranches.length > 0 || remoteOffered
                    ? 'Unticked branches and slice worktrees remain for you to remove.'
                    : ABANDON_CLEANUP.nothing}
            </Text>
            {confirmLoss && (
                <div ref={scrollIn}>
                    <Alert
                        tone="danger"
                        data-cleanup-loss
                        title="Deleting local work will lose these files and commits"
                    >
                        <ul className="m-0 list-disc ps-5 wrap-anywhere">
                            {cleanup.plans
                                .filter((plan) => plan.dirtyFiles.length || plan.unpushedCommits.length)
                                .map((plan) => (
                                    <li key={plan.branch}>
                                        <span>{plan.branch}</span>
                                        <ul className="m-0 list-disc ps-5">
                                            {[...plan.dirtyFiles, ...plan.unpushedCommits].map((loss) => (
                                                <li key={loss}>
                                                    {loss.startsWith(`${plan.branch}: `)
                                                        ? loss.slice(plan.branch.length + 2)
                                                        : loss}
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                        </ul>
                    </Alert>
                </div>
            )}
        </>
    );
}
