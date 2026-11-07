// Onboarding's access step: what the board can do in the repository with your access.

import { trackerCapabilities, type SetupDetection } from '@lar-factory/shared';
import { BoardNote, HelpTip, SetupStep } from '@lar-works/design-system';

import { useWizardStore, type Run } from './WizardStore';
import { AccessList, accessRows, operationNames, type AccessRow } from '@/features/repositories';

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
                <BoardNote>
                    New {labels} stay off until {names['manage-labels']} is allowed.
                    <HelpTip label="label access">
                        You can add this Project without it. Until it is allowed, Settings can't create, rename or
                        delete {labels}.
                    </HelpTip>
                </BoardNote>
            )}
            {buildsShort && (
                <BoardNote>
                    Builds and docs need permission to push branches and open PRs.
                    <HelpTip label="build access">
                        You can shape issues now. Builds need permission to push branches and open pull requests.
                        {detection.provider === 'GitHub' && (
                            <>
                                {' '}
                                Builds need Contents and Pull requests: Read and write in your GitHub token or app.
                                {unverified &&
                                    ' This read-only check cannot verify fine-grained token permissions. To verify writes, use a classic token or gh OAuth login with repo scope.'}
                            </>
                        )}
                    </HelpTip>
                </BoardNote>
            )}
            {other.length > 0 && (
                <BoardNote data-other-access>
                    Also unavailable:{' '}
                    {other
                        .map((row) => `${row.name}, ${row.access === 'refused' ? 'Refused' : 'Not checked'}`)
                        .join('; ')}
                    . Options that need this access stay off.
                </BoardNote>
            )}
        </SetupStep>
    );
}
