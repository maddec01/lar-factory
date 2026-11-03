// Onboarding screens built from the board's existing controls.
import { FolderPlus, LoaderCircle, Check, Minus } from 'lucide-react';
import { effectiveIssueSettings, isOnboarding, shownRepo, trackerCapabilities, type OperationAccess, type ProjectChoice, type SetupDetection } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { FormSelect } from '@lar-factory/ui/form-select';
import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { Choice, Field, Group } from './setup-fields.tsx';
import { KindMapping } from './kind-mapping.tsx';
import { IssueDefaults } from '../repositories/issue-defaults.tsx';
import { answersOf, connectionOptions, connectionsOf, found, repositoryDocs, skillOptions, sourceOptions } from './wizard-choices.ts';
import { detectedOf, unpickable, useWizardStore, type Run } from './wizard-store.ts';

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew, loadProjects, setFolder, createProject } = useWizardStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  if (projects.state === 'loading') return <Pending>Loading repositories…</Pending>;
  if (projects.state === 'failed') return <Alert tone="danger" title="Could not load repositories" action={<Button {...kind('other')} onClick={() => void loadProjects()}>Retry</Button>}>{projects.error}</Alert>;
  const rows = projects.projects.map((project) => ({ project, reason: unpickable(project, run, { onboarding }) }));
  const added = rows.filter(({ project, reason }) => reason && project.onBoard);
  const blocked = rows.filter(({ project, reason }) => reason && !project.onBoard);
  return <><Group legend="Choose a repository">
    <RadioGroup value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => id === 'new' ? chooseNew() : pick(id as string)} className="min-w-0 gap-1.5">
      {rows.filter(({ reason }) => !reason).map(({ project }) => <Choice key={project.id} value={project.id}><ProjectLine project={project} badge={project.provider} /></Choice>)}
      <Choice value="new"><span className="flex min-w-0 flex-1 items-center gap-2">
        <FolderPlus aria-hidden className="size-4 shrink-0" />
        <span className="shrink-0 font-medium">Add a repository folder</span>
        <span className="min-w-0 flex-1 truncate text-xs text-base-700">Choose a folder already on this machine.</span>
      </span></Choice>
    </RadioGroup>
    {creating && <div className="grid gap-3 rounded-lg border p-3">
      <Field label="Repository folder">
        {(described) => <Input placeholder="~/Developer/my-project" value={creating.folder} disabled={creating.adding} {...described}
          onChange={(event) => setFolder(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && creating.folder.trim()) void createProject(); }} />}
      </Field>
      <span><Button {...kind('other')} leftIcon={<FolderPlus />} disabled={!creating.folder.trim()} loading={creating.adding} onClick={() => void createProject()}>Add folder</Button></span>
      {creating.error && <Alert tone="danger" title="Could not add folder">{creating.error}</Alert>}
    </div>}
  </Group>
  <ProjectSection name="added" title="Already added" count={added.length}>
    {added.map(({ project }) => <li key={project.id} className="flex min-w-0"><ProjectLine project={project} badge={isOnboarding({ onboarding }, project.repo) ? 'Setup in progress' : 'Added'} /></li>)}
  </ProjectSection>
  <ProjectSection name="blocked" title="Can't be added" count={blocked.length}>
    {blocked.map(({ project, reason }) => <li key={project.id} className="grid min-w-0 gap-0.5"><ProjectLine project={project} badge={null} /><span className="pl-6 text-xs text-base-700">{reason}</span></li>)}
  </ProjectSection></>;
}

/** A project on one line: its icon's spot, name and badge, then its path, which gives way first. */
function ProjectLine({ project, badge }: { project: ProjectChoice; badge: string | null }) {
  return <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
    <span data-project-icon aria-hidden className="size-4 shrink-0" />
    <span title={project.name} className="max-w-1/2 shrink-0 truncate font-medium">{project.name}</span>
    {badge && <span className="shrink-0 whitespace-nowrap"><Badge>{badge}</Badge></span>}
    <span data-project-path aria-hidden title={project.folder} className="min-w-0 flex-1 truncate text-xs text-base-700">{project.shownFolder}</span>
    <span className="sr-only">{project.folder}</span>
  </span>;
}

/** Projects that can't be picked, folded under their count; nothing when there are none. */
function ProjectSection({ name, title, count, children }: { name: string; title: string; count: number; children: React.ReactNode }) {
  return count > 0 && <details data-project-section={name} className="min-w-0 rounded-lg border px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">{title} ({count})</summary>
    <ul className="m-0 mt-2 grid min-w-0 list-none gap-2 p-0">{children}</ul>
  </details>;
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
  const { choose, detect } = useWizardStore();
  const repos = useBoardStore((s) => s.data.repos);
  const answers = answersOf(detection, run.choices);
  const sources = sourceOptions(detection);
  const connections = connectionOptions(run.repo!, repos);
  const selected = connectionsOf(run.repo!, answers.role, run.choices, repos);
  const skills = skillOptions(detection);
  const issueSetup = { ...detection, ...answers };
  const issueDefaults = effectiveIssueSettings(issueSetup);
  return <div data-work-step className="grid gap-5">
    <Field label="Show in the list" problem={!sources.length ? ('refused' in detection.itemSources ? detection.itemSources.refused : 'No teams found. Add a team in Azure DevOps, then retry.') : undefined}>
      {() => detection.provider === 'GitHub' ? <p className="m-0 text-sm">GitHub issues</p> : <FormSelect aria-label="Team" placeholder="Choose a team" value={answers.itemSource?.kind === 'azure-board' ? answers.itemSource.team : ''}
        onChange={(team) => choose({ itemSource: { kind: 'azure-board', team } })}
        choices={sources.map((source) => ({ value: source.id, name: source.title }))} />}
    </Field>
    <div className="grid gap-4 rounded-lg border p-4">
      <p className="m-0 text-sm text-base-700">Legacy structural publication is suspended. Concepts and links stay on this machine.</p>
      <Checkbox label="Write glossary and decisions in build PRs" checked={answers.domainDocs.kind === 'repository'} onChange={() => choose({ domainDocs: answers.domainDocs.kind === 'repository' ? { kind: 'off' } : repositoryDocs(detection) })} />
      <p className="m-0 -mt-2 pl-7 text-xs text-base-700">Builds include new domain terms and decisions for review.</p>
    </div>
    <IssueDefaults setup={issueSetup} onChange={(key, value) => choose({ [key]: value })} />
    {(issueDefaults.createReason || issueDefaults.specReason) && <span><Button {...kind('other')} onClick={() => void detect()}>Recheck access</Button></span>}
    <KindMapping key={run.repo} run={run} detection={detection} />
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

function AccessStep({ detection }: { run: Run; detection: SetupDetection }) {
  const detect = useWizardStore((s) => s.detect);
  const labels = trackerCapabilities(detection.repo).heading.toLowerCase();
  const manageLabels = detection.access['manage-labels'];
  const rows: { name: string; access: OperationAccess }[] = [
    { name: 'Read issues', access: 'found' in detection.itemSources && detection.itemSources.found.length > 0 ? 'allowed' : 'refused' },
    { name: `Manage ${labels}`, access: manageLabels },
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
    {manageLabels !== 'allowed' && <p className="m-0 text-sm text-base-700">You can add this repository without it. Until it is allowed, Settings can't create, rename or delete {labels}.</p>}
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
