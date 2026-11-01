// Three onboarding screens built from the board's existing controls.
import { FolderPlus, LoaderCircle, Check, Minus } from 'lucide-react';
import { isOnboarding, shownRepo, type OperationAccess, type SetupDetection } from '@lar-factory/shared';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { Choice, Field, Group } from './setup-fields.tsx';
import { answersOf, connectionOptions, connectionsOf, found, missingSyncAccess, operationTitle, repositoryDocs, skillOptions, sourceOptions } from './wizard-choices.ts';
import { detectedOf, unpickable, useWizardStore, type Run } from './wizard-store.ts';

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew, loadProjects, setFolder, createProject } = useWizardStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  if (projects.state === 'loading') return <Pending>Loading repositories…</Pending>;
  if (projects.state === 'failed') return <Alert tone="danger" title="Could not load repositories" action={<Button {...kind('other')} onClick={() => void loadProjects()}>Retry</Button>}>{projects.error}</Alert>;
  return <Group legend="Choose a repository">
    <RadioGroup value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => id === 'new' ? chooseNew() : pick(id as string)} className="gap-2">
      {projects.projects.map((project) => {
        const reason = unpickable(project, run, { onboarding });
        return <Choice key={project.id} value={project.id} disabled={!!reason} title={<span className="flex flex-wrap items-center gap-2">{project.name}
          {project.provider && <Badge>{project.provider}</Badge>}{project.onBoard && <Badge>{isOnboarding({ onboarding }, project.repo) ? 'Setup in progress' : 'Added'}</Badge>}</span>}>
          <span className="block break-all">{project.folder}</span>{reason && <span className="block">{reason}</span>}
        </Choice>;
      })}
      <Choice value="new" title="Add a repository folder">Choose a folder already on this machine.</Choice>
    </RadioGroup>
    {creating && <div className="grid gap-3 rounded-lg border p-3">
      <Field label="Repository folder">
        {(described) => <Input placeholder="~/Developer/my-project" value={creating.folder} disabled={creating.adding} {...described}
          onChange={(event) => setFolder(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && creating.folder.trim()) void createProject(); }} />}
      </Field>
      <span><Button {...kind('other')} leftIcon={<FolderPlus />} disabled={!creating.folder.trim()} loading={creating.adding} onClick={() => void createProject()}>Add folder</Button></span>
      {creating.error && <Alert tone="danger" title="Could not add folder">{creating.error}</Alert>}
    </div>}
  </Group>;
}

function Pending({ children }: { children: React.ReactNode }) {
  return <p role="status" className="m-0 flex items-center gap-2 py-4 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" />{children}</p>;
}

function DetectionPending() {
  const { detection, detect } = useWizardStore();
  return detection?.state === 'failed' ? <Alert tone="danger" title="Could not check the repository" action={<Button {...kind('other')} onClick={() => void detect()}>Retry</Button>}>{detection.error}</Alert>
    : <Pending>Checking the repository and your access…</Pending>;
}

function WorkStep({ run, detection }: { run: Run; detection: SetupDetection }) {
  const choose = useWizardStore((s) => s.choose);
  const repos = useBoardStore((s) => s.data.repos);
  const answers = answersOf(detection, run.choices);
  const sources = sourceOptions(detection);
  const connections = connectionOptions(run.repo!, repos);
  const selected = connectionsOf(run.repo!, answers.role, run.choices, repos);
  const skills = skillOptions(detection);
  return <div data-work-step className="grid gap-5">
    <Field label="Show in the list" problem={!sources.length ? ('refused' in detection.itemSources ? detection.itemSources.refused : 'No teams found. Add a team in Azure DevOps, then retry.') : undefined}>
      {() => detection.provider === 'GitHub' ? <p className="m-0 text-sm">GitHub issues</p> : <NativeSelect aria-label="Team" value={answers.itemSource?.kind === 'azure-board' ? answers.itemSource.team : ''}
        onChange={(event) => choose({ itemSource: { kind: 'azure-board', team: event.target.value } })}>
        {!answers.itemSource && <option value="">Choose a team</option>}{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
      </NativeSelect>}
    </Field>
    <div className="grid gap-4 rounded-lg border p-4">
      <Checkbox label="Save concepts and cross-repository links to issues" checked={answers.structureSync} onChange={() => choose({ structureSync: !answers.structureSync })} />
      <p className="m-0 -mt-2 pl-7 text-xs text-base-700">Restore their maps and relationships on another machine. Regular work and progress stay local.</p>
      <Checkbox label="Write glossary and decisions in build PRs" checked={answers.domainDocs.kind === 'repository'} onChange={() => choose({ domainDocs: answers.domainDocs.kind === 'repository' ? { kind: 'off' } : repositoryDocs(detection) })} />
      <p className="m-0 -mt-2 pl-7 text-xs text-base-700">Builds include new domain terms and decisions for review.</p>
    </div>
    <details className="rounded-lg border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">Optional settings</summary>
      <div className="mt-4 grid gap-4">
        <Field label="What this repository does" hint="Helps agents place work across repositories.">
          {(described) => <Input placeholder="API used by the mobile app" value={answers.role} {...described} onChange={(event) => choose({ role: event.target.value })} />}
        </Field>
        {connections.length > 0 && <Group legend="Related repositories">{connections.map((option) => <Checkbox key={option.id} label={option.title} checked={selected.includes(option.value)} onChange={() => choose({ connections: selected.includes(option.value) ? selected.filter((repo) => repo !== option.value) : [...selected, option.value] })} />)}</Group>}
        {skills.length > 0 && <Group legend="Coding skills for builds">{skills.map((option) => <Checkbox key={option.id} label={option.title} checked={answers.skills.includes(option.value)} onChange={() => choose({ skills: answers.skills.includes(option.value) ? answers.skills.filter((skill) => skill !== option.value) : [...answers.skills, option.value] })} />)}</Group>}
      </div>
    </details>
  </div>;
}

function AccessStep({ run, detection }: { run: Run; detection: SetupDetection }) {
  const detect = useWizardStore((s) => s.detect);
  const answers = answersOf(detection, run.choices);
  const missing = answers.structureSync ? missingSyncAccess(detection) : [];
  const syncAccess: OperationAccess = missing.length === 0 ? 'allowed' : missing.some((op) => detection.access[op] === 'refused') ? 'refused' : 'unverified';
  const rows: { name: string; access: OperationAccess }[] = [
    { name: 'Read issues', access: 'found' in detection.itemSources && detection.itemSources.found.length > 0 ? 'allowed' : 'refused' },
    ...answers.structureSync ? [{ name: 'Save concept maps and links', access: syncAccess }] : [],
    { name: 'Push build branches', access: detection.access['push-branch'] },
    { name: 'Open build pull requests', access: detection.access['open-pr'] },
  ];
  const unverified = rows.some((row) => row.access === 'unverified');
  return <div data-access-step className="grid gap-4">
    <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
      {rows.map((row) => <li key={row.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{row.name}</span>
        <span className={`flex shrink-0 items-center gap-1.5 text-xs ${row.access === 'allowed' ? 'text-base-700' : 'text-(--lar-danger-text)'}`}>{row.access === 'allowed' ? <Check className="size-4" /> : <Minus className="size-4" />}{row.access === 'allowed' ? 'Ready' : row.access === 'unverified' ? 'Not verified' : 'Needs access'}</span>
      </li>)}
    </ul>
    {missing.length > 0 && <Alert tone="danger" title="Concept sync needs write access">
      Allow {missing.map((op) => operationTitle(op, detection).toLowerCase()).join(', ')} in {detection.provider}. {detection.provider === 'GitHub' ? 'Grant Issues: Read and write to your GitHub token or app.' : 'Grant work item read, write and comment permissions in Azure DevOps.'} Then recheck, or turn off concept sync in the previous step.
    </Alert>}
    {rows.slice(-2).some((row) => row.access !== 'allowed') && <p className="m-0 text-sm text-base-700">You can shape issues now. Builds need permission to push branches and open pull requests.</p>}
    {detection.provider === 'GitHub' && rows.slice(-2).some((row) => row.access !== 'allowed') && <p className="m-0 text-sm text-base-700">Builds need Contents and Pull requests: Read and write in your GitHub token or app.</p>}
    {detection.provider === 'GitHub' && unverified && <p className="m-0 text-sm text-base-700">This read-only check cannot verify fine-grained token permissions. To verify writes, use a classic token or gh OAuth login with repo scope.</p>}
    <p className="m-0 text-xs text-base-700">Settings stay on this machine. No setup files are added to the repository.</p>
    <span><Button {...kind('other')} onClick={() => void detect()}>Recheck access</Button></span>
  </div>;
}

export function StepBody({ run }: { run: Run }) {
  const { detection: read, finish } = useWizardStore();
  const detection = detectedOf(read);
  if (finish.state === 'done') return <Alert data-done tone="success" title={`${shownRepo(run.repo!)} is ready`}>Open its list to queue an issue for shaping.</Alert>;
  return <div className="grid gap-4">
    {finish.state === 'failed' && <Alert tone="danger" title="Could not add repository">{finish.error}</Alert>}
    {run.step === 'project' ? <ProjectStep run={run} /> : !detection ? <DetectionPending />
      : 'refused' in detection.checkout ? <Alert tone="danger" title="Check the repository folder">{detection.checkout.refused}</Alert>
        : run.step === 'work' ? <WorkStep run={run} detection={detection} /> : <AccessStep run={run} detection={detection} />}
  </div>;
}
