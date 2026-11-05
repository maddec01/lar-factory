import { REPOSITORY_OPERATIONS, onAzure, trackerCapabilities, type OperationAccess, type RepositoryOperation, type RepositorySetup } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { FIELD_GROUP, FieldRow, HelpTip } from '../settings/field-row.tsx';
import { ToolState } from '../settings/controls.tsx';

export function operationNames(repo: string): Record<RepositoryOperation, string> {
  const azure = onAzure(repo);
  const labels = trackerCapabilities(repo).heading.toLowerCase();
  return { 'push-branch': 'Push branches', 'open-pr': 'Open PRs', 'edit-ticket': azure ? 'Edit work items' : 'Edit issues',
    'publish-ticket': azure ? 'Create work items' : 'Create issues', 'tag-ticket': `Set ${labels}`, 'manage-labels': `Manage ${labels}`,
    'comment-ticket': 'Post comments', 'type-ticket': azure ? 'Set work item types' : 'Set issue types', 'relate-ticket': 'Set relationships' };
}

export interface AccessRow { name: string; access: OperationAccess; operation?: RepositoryOperation }
export const accessRows = (setup: Pick<RepositorySetup, 'repo' | 'access'>): AccessRow[] => REPOSITORY_OPERATIONS.map((operation) => ({ name: operationNames(setup.repo)[operation], access: setup.access[operation], operation }));

export function AccessList({ rows, checking = false, onRecheck }: { rows: AccessRow[]; checking?: boolean; onRecheck?: (() => void) | undefined }) {
  return <div data-access data-access-list className="grid min-w-0 gap-3">
    <div className={FIELD_GROUP}>{rows.map((row) => <div key={row.name} data-operation={row.operation}>
      <FieldRow label={row.name}><ToolState text={checking ? 'Checking…' : { allowed: 'Allowed', refused: 'Refused', unverified: 'Not checked' }[row.access]} tone={checking ? 'muted' : row.access === 'allowed' ? 'success' : row.access === 'refused' ? 'error' : 'muted'} /></FieldRow>
    </div>)}</div>
    {onRecheck && <span><Button {...kind('other')} loading={checking} onClick={onRecheck}>Recheck access</Button></span>}
  </div>;
}

export function AccessReason({ reason, onRecheck, checking = false }: { reason: string; onRecheck?: (() => void) | undefined; checking?: boolean }) {
  const short = reason.split('. ')[0]!.replace(/\.$/, '');
  return <span className="inline-flex min-w-0 flex-wrap items-center gap-1 text-xs text-(--muted-foreground)">
    <span>{short}.</span><HelpTip title="access">{reason}</HelpTip>
    {onRecheck && <button type="button" className="cursor-pointer bg-transparent p-0 text-(--foreground) underline" disabled={checking} onClick={onRecheck}>{checking ? 'Checking…' : 'Recheck'}</button>}
  </span>;
}
