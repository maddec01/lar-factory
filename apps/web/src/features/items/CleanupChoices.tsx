import { ABANDON_CLEANUP } from '@lar-factory/shared';
// A confirmation's choice to remove work's old branches and worktrees, and to confirm losing what they hold. Inspecting
// only reads; the board changes nothing until the confirmation executes the ticked steps.
import { Alert, Checkbox, Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { useCleanupChoices } from './useCleanupChoices';
import { LossList } from '@/ui/board';

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
                <Checkbox
                    label={`Remove old local worktrees and branches: ${localBranches.join(', ')}`}
                    checked={local}
                    onChange={(event) => choices.setLocal(event.target.checked)}
                />
            )}
            {remoteOffered && (
                <Checkbox
                    label={`Delete pushed remote branch: ${remoteBranches.join(', ')}`}
                    checked={remote}
                    onChange={(event) => choices.setRemote(event.target.checked)}
                />
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
                        <LossList
                            branches={cleanup.plans
                                .filter((plan) => plan.dirtyFiles.length || plan.unpushedCommits.length)
                                .map((plan) => ({
                                    name: plan.branch,
                                    losses: [...plan.dirtyFiles, ...plan.unpushedCommits].map((loss) =>
                                        loss.startsWith(`${plan.branch}: `) ? loss.slice(plan.branch.length + 2) : loss,
                                    ),
                                }))}
                        />
                    </Alert>
                </div>
            )}
        </>
    );
}
