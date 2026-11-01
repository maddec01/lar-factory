// The repository editor keeps all settings on this machine.
import type { ReactNode } from 'react';
import { REPOSITORY_OPERATIONS, onAzure, sameRepo, shownRepo, type OperationAccess, type RepositoryOperation, type RepositorySetup } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { FormSelect } from '@lar-factory/ui/form-select';
import { useBoardStore } from '../board/board-store.ts';
import { canSave, shownDrafts, useEditStore, type Drafts, type DraftSetting } from './edit-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { EditVocabulary } from './vocabulary-editor.tsx';
import { IssueDefaults } from './issue-defaults.tsx';

const ACCESS: Record<OperationAccess, string> = { allowed: 'Allowed', refused: 'Refused', unverified: 'Not checked yet' };

const OPERATIONS = (azure: boolean): Record<RepositoryOperation, string> => ({
  'push-branch': 'Push branches', 'open-pr': 'Open PRs', 'edit-ticket': azure ? 'Edit work items' : 'Edit issues',
  'publish-ticket': azure ? 'Create work items' : 'Create issues', 'tag-ticket': azure ? 'Set tags' : 'Set labels', 'manage-labels': azure ? 'Manage tags' : 'Manage labels',
  'comment-ticket': 'Post comments', 'type-ticket': azure ? 'Set work item types' : 'Set issue types', 'relate-ticket': 'Set relationships',
});

/** One setting: its name, source and editor, Save, and Use shared default while it is set on this Mac. */
function Setting({ repo, setup, name, hint, settingKey, children }: {
  repo: string; setup: RepositorySetup; name: string; hint?: string; settingKey: DraftSetting; children: ReactNode;
}) {
  const { typed, running, save, reset } = useEditStore();
  const source = setup.sources[settingKey];
  const editable = !(settingKey === 'itemSource' && !onAzure(repo));
  return (
    <div data-setting={settingKey} className="grid gap-1.5">
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{name}</span>
      {hint && <p className="m-0 text-xs text-base-700">{hint}</p>}
      {children}
      {editable && <span className="flex flex-wrap gap-2">
        <Button {...kind('other')} disabled={running !== null || !canSave(settingKey, setup, typed)} loading={running === settingKey}
          onClick={() => void save(repo, settingKey, setup)}>Save</Button>
        {source === 'local' && <Button {...kind('other')} disabled={running !== null} onClick={() => void reset(repo, settingKey)}>
          Reset</Button>}
      </span>}
    </div>
  );
}

function Settings({ repo, setup }: { repo: string; setup: RepositorySetup }) {
  const { typed, running, type } = useEditStore();
  const drafts = shownDrafts(setup, typed);
  const azure = onAzure(repo);
  const text = (field: keyof Drafts, label: string, placeholder?: string) => (
    <Input aria-label={label} placeholder={placeholder} value={drafts[field]} disabled={running !== null} onChange={(e) => type(field, e.target.value)} />
  );
  return (
    <fieldset className="m-0 grid min-w-0 gap-5 border-0 p-0">
      <Setting repo={repo} setup={setup} settingKey="role" name="What this repository does" hint="Describe its purpose so agents know where to work.">
        {text('role', 'What this repository does')}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="itemSource" name="Work to read">
        {azure ? text('team', 'Team') : <p className="m-0 text-xs text-base-700">This repository's GitHub issues.</p>}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="labels" name={azure ? 'Custom tags' : 'Custom labels'} hint="Separate them with commas.">
        {text('labels', azure ? 'Custom tags' : 'Custom labels', 'area: server, area: web')}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="domainDocs" name="Glossary and decisions" hint="Choose whether builds include domain docs in their PRs.">
        <FormSelect aria-label="Domain docs" value={drafts.domainDocs} disabled={running !== null} onChange={(value) => type('domainDocs', value)}
          choices={[{ value: 'off', name: 'Off' }, { value: 'repository', name: 'Write in build PRs' }]} />
        {drafts.domainDocs === 'repository' && <span className="grid gap-2 sm:grid-cols-2">{text('glossary', 'Glossary path')}{text('adrs', 'ADR folder')}</span>}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="skills" name="Project skills" hint="Coding guidance for builds. Separate them with commas.">
        {text('skills', 'Project skills')}
      </Setting>
    </fieldset>
  );
}

function Access({ repo, setup }: { repo: string; setup: RepositorySetup }) {
  const { running, recheck } = useEditStore();
  const names = OPERATIONS(onAzure(repo));
  return <details className="rounded-lg border p-3" data-access>
    <summary className="cursor-pointer text-sm font-medium">Access</summary>
    <ul className="m-0 mt-3 grid list-none gap-2 p-0 text-sm">
      {REPOSITORY_OPERATIONS.map((op) => <li key={op} data-operation={op} className="flex justify-between gap-2"><span>{names[op]}</span><span className="text-xs text-base-700">{ACCESS[setup.access[op]]}</span></li>)}
    </ul>
    <Button {...kind('other')} className="mt-3" disabled={running !== null} loading={running === 'recheck'} onClick={() => void recheck(repo)}>Recheck access</Button>
  </details>;
}

export function EditDialog() {
  const { repo, errors, running, close } = useEditStore();
  const setup = useBoardStore((s) => s.data.repos.find((r) => repo !== null && sameRepo(r.repo, repo))?.setup);
  if (!repo || !setup) return null;
  return (
    <Modal loading={running !== null} onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the description names itself. */}
      <Modal.Content data-edit-dialog title={`Edit ${shownRepo(repo)}`} description="Change how the factory works with this repository on this Mac." aria-describedby="edit-description">
        <Text id="edit-description" tone="muted" className="shrink-0 px-5 pb-4 text-xs sm:px-6">
          Settings stay on this machine. The repository needs no factory setup files.
        </Text>
        <Modal.Body>
          <div className="grid gap-5">
            <Checkbox label="Save concepts and cross-repository links to issues" checked={setup.structureSync} disabled={running !== null}
              onChange={() => void useEditStore.getState().structureSync(repo, !setup.structureSync)} />
            <p className="m-0 -mt-3 pl-7 text-xs text-base-700">This creates a linked-work label to restore maps and relationships on another machine.</p>
            <IssueDefaults setup={setup} disabled={running !== null} onChange={(key, value) => void useEditStore.getState().issueDefault(repo, key, value)} />
            <EditVocabulary key={repo} setup={setup} />
            <Settings repo={repo} setup={setup} />
            <Access repo={repo} setup={setup} />
            {errors[repo] && <Alert tone="danger" title="Can't change this setting">{errors[repo]}</Alert>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} disabled={running !== null} onClick={close}>Done</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
