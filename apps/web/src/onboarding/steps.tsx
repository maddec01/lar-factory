// Onboarding screens built from the board's existing controls.
import { FolderPlus } from 'lucide-react';
import { writeAccessProblem, isOnboarding, shownRepo, trackerCapabilities, type ProjectChoice, type SetupDetection } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { FormSelect } from '@lar-factory/ui/form-select';
import { useBoardStore } from '../board/board-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { Spinner } from '../loading/loader.tsx';
import { Choice } from './setup-fields.tsx';
import { FIELD_GROUP, FieldRow, HelpTip } from '../settings/field-row.tsx';
import { Switch } from '../settings/controls.tsx';
import { AccessList, AccessReason, accessExplanation, accessRows, operationNames, type AccessRow } from '../repositories/access-list.tsx';
import { KindMapping } from './kind-mapping.tsx';
import { IssueDefaults } from '../repositories/issue-defaults.tsx';
import { ProjectChoiceIcon } from '../repositories/project-icon.tsx';
import { answersOf, connectionOptions, connectionsOf, repositoryDocs, skillOptions, sourceOptions } from './wizard-choices.ts';
import { detectedOf, unpickable, useWizardStore, type Run } from './wizard-store.ts';

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew, loadProjects, setFolder, createProject } = useWizardStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  if (projects.state === 'loading') return <Pending>Loading Projects…</Pending>;
  if (projects.state === 'failed') return <Alert tone="danger" title="Could not load Projects" action={<Button {...kind('other')} onClick={() => void loadProjects()}>Retry</Button>}>{projects.error}</Alert>;
  const rows = projects.projects.map((project) => ({ project, reason: unpickable(project, run, { onboarding }) }));
  const added = rows.filter(({ project, reason }) => reason && project.onBoard);
  const blocked = rows.filter(({ project, reason }) => reason && !project.onBoard);
  return <><div className={FIELD_GROUP}><FieldRow label="T3 project" below={<>
    <RadioGroup aria-label="T3 project" value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => id === 'new' ? chooseNew() : pick(id as string)} className="min-w-0 gap-1.5">
      {rows.filter(({ reason }) => !reason).map(({ project }) => <Choice key={project.id} value={project.id}><ProjectLine project={project} badge={project.provider} /></Choice>)}
      <Choice value="new"><span className="flex min-w-0 flex-1 items-center gap-2">
        <FolderPlus aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 font-medium wrap-anywhere">Add a repository folder</span>
        <span className="min-w-0 flex-1 truncate text-xs text-base-700">Choose a folder already on this machine.</span>
      </span></Choice>
    </RadioGroup>
    {creating && <div className="grid gap-3 rounded-lg border p-3">
      <FieldRow label="Repository folder">
        <Input aria-label="Repository folder" placeholder="~/Developer/my-project" value={creating.folder} disabled={creating.adding}
          onChange={(event) => setFolder(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && creating.folder.trim()) void createProject(); }} />
      </FieldRow>
      <span><Button {...kind('other')} leftIcon={<FolderPlus />} disabled={!creating.folder.trim()} loading={creating.adding} onClick={() => void createProject()}>Add folder</Button></span>
      {creating.error && <Alert tone="danger" title="Could not add folder">{creating.error}</Alert>}
    </div>}
  </>} /></div>
  <ProjectSection name="added" title="Already added" count={added.length}>
    {added.map(({ project }) => <li key={project.id} className="flex min-w-0"><ProjectLine project={project} badge={isOnboarding({ onboarding }, project.repo) ? 'Setup in progress' : 'Added'} /></li>)}
  </ProjectSection>
  <ProjectSection name="blocked" title="Can't be added" count={blocked.length}>
    {blocked.map(({ project, reason }) => <li key={project.id} className="grid min-w-0 gap-0.5"><ProjectLine project={project} badge={null} /><span className="pl-6 text-xs text-base-700">{reason}</span></li>)}
  </ProjectSection></>;
}

/** A project on one line: its icon, name and badge, then its path, which gives way first. */
function ProjectLine({ project, badge }: { project: ProjectChoice; badge: string | null }) {
  return <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
    <ProjectChoiceIcon project={project} size="row" />
    <span title={project.name} className="max-w-[30%] shrink-0 truncate font-medium sm:max-w-1/2">{project.name}</span>
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
  return <p role="status" className="m-0 flex items-center gap-2 py-4 text-sm text-base-700"><Spinner spin="animate-spin" className="size-4" />{children}</p>;
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
  const docsProblem = writeAccessProblem(detection.repo, 'push-branch', detection.access, { azureReadOnly: detection.azureReadOnly })
    ?? writeAccessProblem(detection.repo, 'open-pr', detection.access, { azureReadOnly: detection.azureReadOnly });
  const recheck = () => { void detect(); };
  return <div data-work-step className="grid min-w-0 gap-5">
    <div className={FIELD_GROUP}>
      <FieldRow label="Show in the list" description={!sources.length ? ('refused' in detection.itemSources ? detection.itemSources.refused : 'No teams found. Add a team in Azure DevOps, then recheck access.') : undefined}>
        {detection.provider === 'GitHub' ? <span className="text-xs">GitHub issues</span> : <span className="w-44 max-w-full"><FormSelect aria-label="Team" placeholder="Choose a team" value={answers.itemSource?.kind === 'azure-board' ? answers.itemSource.team : ''}
          onChange={(team) => choose({ itemSource: { kind: 'azure-board', team } })}
          choices={sources.map((source) => ({ value: source.id, name: source.title }))} /></span>}
      </FieldRow>
      <FieldRow id="domainDocs" label="Write glossary and decisions in build PRs" help="Builds include new domain terms and decisions for review."
        description={docsProblem && <AccessReason repo={detection.repo} reason={docsProblem} onRecheck={recheck} />}>
        <Switch label="Write glossary and decisions in build PRs" description={docsProblem ? accessExplanation(detection.repo, docsProblem) : undefined} on={answers.domainDocs.kind === 'repository' && !docsProblem} disabled={!!docsProblem}
          onChange={(on) => choose({ domainDocs: on ? repositoryDocs(detection) : { kind: 'off' } })} />
      </FieldRow>
    </div>
    <IssueDefaults setup={issueSetup} onChange={(key, value) => choose({ [key]: value })} onRecheck={recheck} />
    <KindMapping key={run.repo} run={run} detection={detection} />
    <details className="min-w-0">
      <summary className="cursor-pointer text-[13px] font-semibold">Optional settings</summary>
      <div className={`mt-3 ${FIELD_GROUP}`}>
        <FieldRow label="What this Project does" help="Helps agents place work across Projects.">
          <Input className="w-64 max-w-full" aria-label="What this Project does" placeholder="API used by the mobile app" value={answers.role} onChange={(event) => choose({ role: event.target.value })} />
        </FieldRow>
        {connections.length > 0 && <FieldRow label="Related Projects">{connections.map((option) => <Checkbox key={option.id} label={option.title} checked={selected.includes(option.value)} onChange={() => choose({ connections: selected.includes(option.value) ? selected.filter((repo) => repo !== option.value) : [...selected, option.value] })} />)}</FieldRow>}
        {skills.length > 0 && <FieldRow label="Project skills" help="Coding guidance for builds.">{skills.map((option) => <Checkbox key={option.id} label={option.title} checked={answers.skills.includes(option.value)} onChange={() => choose({ skills: answers.skills.includes(option.value) ? answers.skills.filter((skill) => skill !== option.value) : [...answers.skills, option.value] })} />)}</FieldRow>}
      </div>
    </details>
    <span><Button {...kind('other')} onClick={recheck}>Recheck access</Button></span>
  </div>;
}

function AccessStep({ detection }: { run: Run; detection: SetupDetection }) {
  const detect = useWizardStore((s) => s.detect);
  const labels = trackerCapabilities(detection.repo).heading.toLowerCase();
  const names = operationNames(detection.repo);
  const shown = ['manage-labels', 'push-branch', 'open-pr'] as const;
  const rows: AccessRow[] = [
    { name: detection.provider === 'GitHub' ? 'Read issues' : 'Read work items', access: 'found' in detection.itemSources && detection.itemSources.found.length > 0 ? 'allowed' : 'refused' },
    ...shown.map((operation) => ({ name: names[operation], access: detection.access[operation], operation })),
  ];
  const other = accessRows(detection).filter((row) => ['publish-ticket', 'edit-ticket', 'tag-ticket', 'type-ticket'].includes(row.operation!) && row.access !== 'allowed');
  const buildsShort = rows.slice(-2).some((row) => row.access !== 'allowed');
  const unverified = rows.some((row) => row.access === 'unverified');
  return <div data-access-step className="grid min-w-0 gap-3">
    <AccessList rows={rows} onRecheck={() => void detect()} />
    {detection.access['manage-labels'] !== 'allowed' && <p className="m-0 text-xs text-(--muted-foreground)">New {labels} stay off until {names['manage-labels']} is allowed.
      <HelpTip title="label access">You can add this Project without it. Until it is allowed, Settings can't create, rename or delete {labels}.</HelpTip>
    </p>}
    {buildsShort && <p className="m-0 text-xs text-(--muted-foreground)">Builds and docs need permission to push branches and open PRs.
      <HelpTip title="build access">You can shape issues now. Builds need permission to push branches and open pull requests.
        {detection.provider === 'GitHub' && <> Builds need Contents and Pull requests: Read and write in your GitHub token or app.
          {unverified && ' This read-only check cannot verify fine-grained token permissions. To verify writes, use a classic token or gh OAuth login with repo scope.'}</>}
      </HelpTip>
    </p>}
    {other.length > 0 && <p data-other-access className="m-0 text-xs text-(--muted-foreground)">Also unavailable: {other.map((row) => `${row.name}, ${row.access === 'refused' ? 'Refused' : 'Not checked'}`).join('; ')}. Options that need this access stay off.</p>}
  </div>;
}

export function StepBody({ run }: { run: Run }) {
  const { detection: read, finish } = useWizardStore();
  const detection = detectedOf(read);
  if (finish.state === 'done') return <Alert data-done tone="success" title={`${shownRepo(run.repo!)} is ready`}>Open its list to queue an issue for shaping.</Alert>;
  return <div className="grid gap-4">
    {finish.state === 'failed' && <Alert tone="danger" title="Could not add Project">{finish.error}</Alert>}
    {run.step === 'project' ? <ProjectStep run={run} /> : !detection ? <DetectionPending />
      : 'refused' in detection.checkout ? <Alert tone="danger" title="Check the repository folder">{detection.checkout.refused}</Alert>
        : run.step === 'work' ? <WorkStep run={run} detection={detection} /> : <AccessStep run={run} detection={detection} />}
  </div>;
}
