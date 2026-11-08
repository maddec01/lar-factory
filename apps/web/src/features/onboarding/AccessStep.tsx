// Onboarding's access step: what the board can do in the repository with your access.

import { trackerCapabilities, type SetupDetection } from '@lar-factory/shared';
import { HelpTip, Text } from '@lar-works/design-system';

import { useWizardStore, type Run } from './WizardStore';
import { AccessList, accessRows, operationNames, type AccessRow } from '@/features/repositories';
import { SetupStep } from '@/ui/board';

export function AccessStep({ detection }: { run: Run; detection: SetupDetection }) {
    const detect = useWizardStore((s) => s.detect);
    const labels = trackerCapabilities(detection.repo).heading.toLowerCase();
    const names = operationNames(detection.repo);
    const shown = ['manage-labels', 'push-branch', 'open-pr'] as const;
    const rows: AccessRow[] = [
        {
            name: detection.provider === 'GitHub' ? 'Read issues' : 'Read work items',
            access: 'found' in detection.itemSources && detection.itemSources.found.length > 0 ? 'allowed' : 'refused',
        },
        ...shown.map((operation) => ({ name: names[operation], access: detection.access[operation], operation })),
    ];
    const other = accessRows(detection).filter(
        (row) =>
            ['publish-ticket', 'edit-ticket', 'tag-ticket', 'type-ticket'].includes(row.operation!) &&
            row.access !== 'allowed',
    );
    const buildsShort = rows.slice(-2).some((row) => row.access !== 'allowed');
    const unverified = rows.some((row) => row.access === 'unverified');

    return (
        <SetupStep data-access-step>
            <AccessList rows={rows} onRecheck={() => void detect()} />
            {detection.access['manage-labels'] !== 'allowed' && (
                <Text variant="caption" tone="muted">
                    New {labels} stay off until {names['manage-labels']} is allowed.
                    <HelpTip label="label access">
                        You can add this project without it. Until it is allowed, Settings can’t create, rename or
                        delete {labels}.
                    </HelpTip>
                </Text>
            )}
            {buildsShort && (
                <Text variant="caption" tone="muted">
                    Builds and docs need permission to push branches and open PRs. You can shape issues while access is
                    unavailable.
                    {detection.provider === 'GitHub' && unverified && (
                        <>
                            {' '}
                            This login doesn’t let the board confirm write access. Sign in to GitHub with repository
                            write access, then choose Recheck access.
                        </>
                    )}
                    <HelpTip label="build access">
                        Builds need permission to change code and open pull requests.
                    </HelpTip>
                </Text>
            )}
            {other.length > 0 && (
                <Text variant="caption" tone="muted" data-other-access>
                    Also unavailable:{' '}
                    {other
                        .map((row) => `${row.name}, ${row.access === 'refused' ? 'Refused' : 'Not checked'}`)
                        .join('; ')}
                    . Options that need this access stay off.
                </Text>
            )}
        </SetupStep>
    );
}
