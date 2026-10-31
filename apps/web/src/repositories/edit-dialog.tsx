// Edit's dialog over Settings › Repositories: each of the repository's settings with where its value comes from, an
// editor and Save, which sets it on this Mac over the shared default, and Use shared default once it is set here. Below
// them, what the credentials were found to allow with the consent given, and Recheck access. While a Repository config
// can't be used, the dialog says why and shows the last usable setup. Shared defaults change only through a PR.

import type { ReactNode } from 'react';
import { REPOSITORY_OPERATIONS, onAzure, sameRepo, shownRepo, type OperationAccess, type RepositoryOperation, type RepositorySetup,
  type SettingSource, type SharedRepositorySettings, type SharedSetting } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { useBoardStore } from '../board/board-store.ts';
import { canSave, shownDrafts, useEditStore, type Drafts } from './edit-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const SOURCES: Record<SettingSource, string> = { local: 'Set on this Mac', shared: 'Shared default', default: 'Factory default' };
const SHOWN = { all: 'All items', 'opted-in': 'Items with a status' } as const;
const ACCESS: Record<OperationAccess, string> = { allowed: 'Allowed', refused: 'Refused', unverified: 'Not checked yet' };

const OPERATIONS = (azure: boolean): Record<RepositoryOperation, string> => ({
  'push-branch': 'Push branches', 'open-pr': 'Open PRs', 'publish-ticket': azure ? 'Publish work items' : 'Publish issues',
  'edit-ticket': azure ? 'Edit work items' : 'Edit issues', 'tag-ticket': azure ? 'Tag work items' : 'Label issues',
});

/** A setting's value as the dialog names it. */
function shown<K extends SharedSetting>(key: K, value: SharedRepositorySettings[K]): string {
  const v = value as SharedRepositorySettings[SharedSetting];
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (typeof v === 'string') return key === 'show' ? SHOWN[v as keyof typeof SHOWN] : v || 'none';
  if (v?.kind === 'azure-board') return `${v.team}'s backlog and current sprint`;
  if (v?.kind === 'repository') return `${v.glossary} and ${v.adrs}`;
  return v?.kind === 'private' ? 'Private drafts on this Mac' : "This repository's GitHub issues";
}

/** One setting: its name, source and editor, Save, and Use shared default while it is set on this Mac. */
function Setting({ repo, setup, name, hint, settingKey, children }: {
  repo: string; setup: RepositorySetup; name: string; hint?: string; settingKey: SharedSetting; children: ReactNode;
}) {
  const { typed, running, save, useShared } = useEditStore();
  const source = setup.sources[settingKey];
  const shared = setup.shared[settingKey];
  const editable = !(settingKey === 'itemSource' && !onAzure(repo));
  return (
    <div data-setting={settingKey} className="grid gap-1.5">
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{name}<Badge data-source tone={source === 'local' ? 'accent' : 'neutral'}>{SOURCES[source]}</Badge></span>
      {hint && <p className="m-0 text-xs text-base-700">{hint}</p>}
      {children}
      {source === 'local' && shared !== undefined && <p data-shared className="m-0 text-xs text-base-700">Shared default: {shown(settingKey, shared)}</p>}
      {editable && <span className="flex flex-wrap gap-2">
        <Button {...kind('other')} disabled={running !== null || !canSave(settingKey, setup, typed)} loading={running === settingKey}
          onClick={() => void save(repo, settingKey, setup)}>Save</Button>
        {source === 'local' && <Button {...kind('other')} disabled={running !== null} onClick={() => void useShared(repo, settingKey)}>
          {shared === undefined ? 'Use factory default' : 'Use shared default'}</Button>}
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
      <Setting repo={repo} setup={setup} settingKey="show" name="Show">
        <NativeSelect aria-label="Show" value={drafts.show} disabled={running !== null} onChange={(e) => type('show', e.target.value)}>
          <option value="all">{SHOWN.all}</option>
          <option value="opted-in">{SHOWN['opted-in']}</option>
        </NativeSelect>
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="labels" name={azure ? 'Custom tags' : 'Custom labels'} hint="Separate them with commas.">
        {text('labels', azure ? 'Custom tags' : 'Custom labels', 'area: server, area: web')}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="domainDocs" name="Domain docs" hint="Where builds write the glossary and ADRs.">
        <NativeSelect aria-label="Domain docs" value={drafts.domainDocs} disabled={running !== null} onChange={(e) => type('domainDocs', e.target.value)}>
          <option value="private">Private drafts on this Mac</option>
          <option value="repository">The repository's own files</option>
        </NativeSelect>
        {drafts.domainDocs === 'repository' && <span className="grid gap-2 sm:grid-cols-2">{text('glossary', 'Glossary path')}{text('adrs', 'ADR folder')}</span>}
      </Setting>
      <Setting repo={repo} setup={setup} settingKey="skills" name="Project skills" hint="Coding guidance for builds. Separate them with commas.">
        {text('skills', 'Project skills')}
      </Setting>
    </fieldset>
  );
}

/** What the credentials were found to allow for each operation, whether the user lets the factory offer it, and Recheck access. */
function Access({ repo, setup }: { repo: string; setup: RepositorySetup }) {
  const { running, recheck } = useEditStore();
  const names = OPERATIONS(onAzure(repo));
  return (
    <div data-access className="grid gap-2">
      <span className="text-sm font-medium">Access</span>
      <p className="m-0 text-xs text-base-700">What your credentials allowed when the factory last tried, and what you let it offer. After you change credentials, recheck so each one is tried again when needed.</p>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {REPOSITORY_OPERATIONS.map((op) => <li key={op} data-operation={op} className="flex flex-wrap justify-between gap-2">
          <span>{names[op]}</span>
          <span className="text-xs text-base-700">{ACCESS[setup.access[op]]} · {setup.consent.includes(op) ? 'Offered' : 'Not offered'}</span>
        </li>)}
      </ul>
      <span><Button {...kind('other')} disabled={running !== null} loading={running === 'recheck'} onClick={() => void recheck(repo)}>Recheck access</Button></span>
    </div>
  );
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
          A setting saved here applies on this Mac, over the shared default in .lar-factory.json. Shared defaults change only through a PR on that file.
        </Text>
        <Modal.Body>
          <div className="grid gap-5">
            {setup.sharedProblem && <Alert data-shared-problem tone="warning" role="note" title="Can't use .lar-factory.json">
              {setup.sharedProblem} The board keeps the last usable setup until the file reads again.
            </Alert>}
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
