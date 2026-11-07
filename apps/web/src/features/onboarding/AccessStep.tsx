// Onboarding's access step: what the board can do in the repository with your access.

import { trackerCapabilities, type SetupDetection } from '@lar-factory/shared';

import { useWizardStore, type Run } from './WizardStore';
import { AccessList, accessRows, operationNames, type AccessRow } from '@/features/repositories';
import { HelpTip } from '@/shared/ui/setting-rows/FieldRow';

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
        <div data-access-step className="grid min-w-0 gap-3">
            <AccessList rows={rows} onRecheck={() => void detect()} />
            {detection.access['manage-labels'] !== 'allowed' && (
                <p className="m-0 text-xs text-(--muted-foreground)">
                    New {labels} stay off until {names['manage-labels']} is allowed.
                    <HelpTip title="label access">
                        You can add this Project without it. Until it is allowed, Settings can't create, rename or
                        delete {labels}.
                    </HelpTip>
                </p>
            )}
            {buildsShort && (
                <p className="m-0 text-xs text-(--muted-foreground)">
                    Builds and docs need permission to push branches and open PRs.
                    <HelpTip title="build access">
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
                </p>
            )}
            {other.length > 0 && (
                <p data-other-access className="m-0 text-xs text-(--muted-foreground)">
                    Also unavailable:{' '}
                    {other
                        .map((row) => `${row.name}, ${row.access === 'refused' ? 'Refused' : 'Not checked'}`)
                        .join('; ')}
                    . Options that need this access stay off.
                </p>
            )}
        </div>
    );
}
