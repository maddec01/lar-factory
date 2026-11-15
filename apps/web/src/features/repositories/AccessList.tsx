// A Project's access rows and read-only reasons, with Recheck while the board can ask for access again.

import { type OperationAccess, type RepositoryOperation } from '@lar-factory/shared';
import { Inline, InsetPanel, SettingsReason, Stack } from '@lar-works/design-system';

import { accessExplanation } from './RepositoryAccess';
import { FieldRow } from '@/shared/settings/FieldRow';
import { ToolState } from '@/shared/settings/SettingControls';
import { RetryAction } from '@/ui/board';

export interface AccessRow {
    name: string;
    access: OperationAccess;
    operation?: RepositoryOperation;
}

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
                <Inline as="span">
                    <RetryAction access size="md" busy={checking} onRetry={onRecheck} />
                </Inline>
            )}
        </Stack>
    );
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
        <SettingsReason
            reason={`${short}.`}
            explanation={explanation}
            helpLabel="access"
            action={onRecheck && <RetryAction access inline busy={checking} onRetry={onRecheck} />}
        />
    );
}
