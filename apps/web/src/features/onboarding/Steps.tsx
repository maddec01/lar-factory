// Onboarding screens built from the board's existing controls.

import { shownRepo } from '@lar-factory/shared';
import { Alert, Stack } from '@lar-works/design-system';

import { AccessStep } from './AccessStep';
import { DetectionPending } from './Pending';
import { ProjectStep } from './ProjectStep';
import { detectedOf, useWizardStore, type Run } from './WizardStore';
import { WorkStep } from './WorkStep';

export function StepBody({ run }: { run: Run }) {
    const { detection: read, finish } = useWizardStore();
    const detection = detectedOf(read);

    if (finish.state === 'done')
        return (
            <Alert data-done tone="success" title={`${shownRepo(run.repo!)} is ready`}>
                Open its list to queue an issue for shaping.
            </Alert>
        );

    return (
        <Stack space="section">
            {finish.state === 'failed' && (
                <Alert tone="danger" title="Could not add Project">
                    {finish.error}
                </Alert>
            )}
            {run.step === 'project' ? (
                <ProjectStep run={run} />
            ) : !detection ? (
                <DetectionPending />
            ) : 'refused' in detection.checkout ? (
                <Alert tone="danger" title="Check the repository folder">
                    {detection.checkout.refused}
                </Alert>
            ) : run.step === 'work' ? (
                <WorkStep run={run} detection={detection} />
            ) : (
                <AccessStep run={run} detection={detection} />
            )}
        </Stack>
    );
}
