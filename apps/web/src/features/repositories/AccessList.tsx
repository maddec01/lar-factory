import {
    REPOSITORY_OPERATIONS,
    onAzure,
    trackerCapabilities,
    type OperationAccess,
    type RepositoryOperation,
    type RepositorySetup,
} from '@lar-factory/shared';
import { Button, buttonKind, ButtonRow, InlineLink, InsetPanel, ReasonNote, Stack } from '@lar-works/design-system';

import { FieldRow } from '@/shared/settings/FieldRow';
import { ToolState } from '@/shared/settings/SettingControls';

export function operationNames(repo: string): Record<RepositoryOperation, string> {
    const azure = onAzure(repo);
    const labels = trackerCapabilities(repo).heading.toLowerCase();

    return {
        'push-branch': 'Push branches',
        'open-pr': 'Open PRs',
        'edit-ticket': azure ? 'Edit work items' : 'Edit issues',
        'publish-ticket': azure ? 'Create work items' : 'Create issues',
        'tag-ticket': `Set ${labels}`,
        'manage-labels': `Manage ${labels}`,
        'comment-ticket': 'Post comments',
        'type-ticket': azure ? 'Set work item types' : 'Set issue types',
        'relate-ticket': 'Set relationships',
    };
}

export interface AccessRow {
    name: string;
    access: OperationAccess;
    operation?: RepositoryOperation;
}
export const accessRows = (setup: Pick<RepositorySetup, 'repo' | 'access'>): AccessRow[] =>
    REPOSITORY_OPERATIONS.map((operation) => ({
        name: operationNames(setup.repo)[operation],
        access: setup.access[operation],
        operation,
    }));

export function AccessList({
    rows,
    checking = false,
    onRecheck,
}: {
    rows: AccessRow[];
    checking?: boolean;
    onRecheck?: (() => void) | undefined;
}) {
    return (
        <Stack space="group" data-access data-access-list>
            <InsetPanel presentation="settings">
                {rows.map((row) => (
                    <div key={row.name} data-operation={row.operation}>
                        <FieldRow label={row.name}>
                            <ToolState
                                text={
                                    checking
                                        ? 'Checking…'
                                        : { allowed: 'Allowed', refused: 'Refused', unverified: 'Not checked' }[
                                              row.access
                                          ]
                                }
                                tone={
                                    checking
                                        ? 'muted'
                                        : row.access === 'allowed'
                                          ? 'success'
                                          : row.access === 'refused'
                                            ? 'error'
                                            : 'muted'
                                }
                            />
                        </FieldRow>
                    </div>
                ))}
            </InsetPanel>
            {onRecheck && (
                <ButtonRow>
                    <Button {...buttonKind('other')} loading={checking} onClick={onRecheck}>
                        Recheck access
                    </Button>
                </ButtonRow>
            )}
        </Stack>
    );
}

export function accessExplanation(repo: string, reason: string): string {
    const names = operationNames(repo);

    return REPOSITORY_OPERATIONS.reduce((text, operation) => text.replaceAll(operation, names[operation]), reason);
}

export function AccessReason({
    repo,
    reason,
    onRecheck,
    checking = false,
}: {
    repo: string;
    reason: string;
    onRecheck?: (() => void) | undefined;
    checking?: boolean;
}) {
    const explanation = accessExplanation(repo, reason);
    const short = explanation.split('. ')[0]!.replace(/\.$/, '');

    return (
        <ReasonNote
            reason={`${short}.`}
            explanation={explanation}
            helpLabel="access"
            action={
                onRecheck && (
                    <InlineLink disabled={checking} onClick={onRecheck}>
                        {checking ? 'Checking…' : 'Recheck'}
                    </InlineLink>
                )
            }
        />
    );
}
