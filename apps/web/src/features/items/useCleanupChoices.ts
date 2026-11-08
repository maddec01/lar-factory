// A confirmation's inspected cleanup plans and ticked choices, with a fresh loss confirmation on each inspection.
// Inspection only reads; execution sends the choices the user confirmed.

import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';

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
