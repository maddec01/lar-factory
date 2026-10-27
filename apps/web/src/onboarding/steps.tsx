// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. The Cleanup step lists each Clash the fixed checks find, with its edit to tick, and asks
// Delete or Rename for each project skill named like a bundled skill. The Pull request step opens the PR that adds .lar-factory.json, then waits for its merge.

import { useId, useState, type ReactNode } from 'react';
import { Check, CircleAlert, FolderPlus, GitPullRequest, Info, LoaderCircle, Lock, RotateCw, X } from 'lucide-react';
import {
  SETUP_CHECKS, isOnboarding, isSkillName, onboardingConfigFile, type Clash, type ProjectChoice, type RepositoryItemSource, type SetupAnswers, type SetupCheckId, type ShowSetting,
  type SkillClash,
} from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Checkbox } from '@lar-factory/ui/checkbox';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { Progress } from '@lar-factory/ui/progress';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { useBoardStore } from '../board/board-store.ts';
import { CopyButton } from '../copy/copy-button.tsx';
import { toolDescription, toolState } from '../settings/settings-pages.tsx';
import {
  COMMAND_CHECKS, type Clashes, type Creating, type Run, type StepId, asksSetup, commandPasses, configOf, itemSourceOf, onboarded, pickedProject, prClosed,
  setupProblems, skillProblem, skillsDir, suggestedShow, ticked, unpickable, useWizardStore,
} from './wizard-store.ts';

/** One choice of a radio group: its title, then a line of detail. */
function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <label data-choice={value} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-data-checked:border-ring has-data-checked:bg-accent/40 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <Radio value={value} disabled={disabled} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-sm font-medium">{title}</span>{children && <span className="text-xs text-muted-foreground">{children}</span>}</span>
    </label>
  );
}

/** The props that tie a field's control to its help and problem. */
type Described = { 'aria-describedby'?: string; 'aria-invalid'?: true };

/**
 * One field on its own row: its label and control, one line of help, then what Next waits for from it, if anything.
 * The help and problem sit outside the label and describe the control, so they aren't read as its name. The problem
 * is muted help until `invalid`, which marks it and the control.
 */
function Field({ name, label, hint, problem, invalid = false, children }: {
  name?: string; label: string; hint?: ReactNode; problem?: string; invalid?: boolean; children: (described: Described) => ReactNode;
}) {
  const id = useId();
  const marked = !!problem && invalid;
  const describedBy = [hint && `${id}-hint`, problem && `${id}-problem`].filter(Boolean).join(' ');
  return (
    <div data-field={name} className="grid gap-1.5">
      <label className="grid gap-1.5"><span className="text-sm font-medium">{label}</span>
        {children({ ...describedBy && { 'aria-describedby': describedBy }, ...marked && { 'aria-invalid': true } })}</label>
      {hint && <span id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</span>}
      {problem && <span id={`${id}-problem`} data-problem className={`text-xs ${marked ? 'text-destructive-foreground' : 'text-muted-foreground'}`}>{problem}</span>}
    </div>
  );
}

/** A group of choices on its own row: its legend, one line of help, then the choices. */
function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Fieldset unstyled className="grid gap-2">
      <FieldsetLegend className="mb-0 font-medium">{legend}</FieldsetLegend>
      {hint && <p className="m-0 -mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </Fieldset>
  );
}

/** Whether the project's repository has .lar-factory.json; reading an Azure DevOps repository waits for build #386. */
function ConfigBadge({ project }: { project: ProjectChoice }) {
  if (project.hasConfig) return <Badge variant="info" size="sm">has .lar-factory.json</Badge>;
  if (project.hasConfig === false) return <Badge variant="outline" size="sm">no .lar-factory.json</Badge>;
  return project.provider === 'GitHub' && <Badge variant="outline" size="sm">couldn’t check .lar-factory.json</Badge>;
}

/** A problem with Retry, which reads T3's projects and their Repository configs again. */
function Problem({ title, children }: { title: string; children: ReactNode }) {
  const loadProjects = useWizardStore((s) => s.loadProjects);
  return (
    <Alert variant="error"><CircleAlert /><AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      <AlertAction><Button size="xs" variant="outline" onClick={() => void loadProjects()}><RotateCw /> Retry</Button></AlertAction>
    </Alert>
  );
}

/** What a step shows while T3's projects are read, or when they can't be; null once they are. */
function ProjectsPending() {
  const projects = useWizardStore((s) => s.projects);
  if (projects.state === 'loading') {
    return <p data-reading-projects className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading T3 Code’s projects…</p>;
  }
  if (projects.state === 'failed') return <Problem title="Can’t list T3 Code’s projects">{projects.error}</Problem>;
  return null;
}

/** Create a new T3 project's folder, which Add runs `t3 project add` on; a failure shows t3's message and keeps the step. */
function NewProject({ creating }: { creating: Creating }) {
  const { setFolder, createProject } = useWizardStore();
  const add = () => void createProject();
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <Field label="Folder" hint="The repository’s main checkout on this Mac, as a full path. T3 Code adds it as a project.">
        {(described) => <span className="flex gap-2">
          <Input data-new-folder font="mono" placeholder="~/Developer/lar-web" value={creating.folder} disabled={creating.adding} {...described}
            onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Button data-add-project variant="outline" disabled={creating.adding || !creating.folder.trim()} onClick={add}>
            {creating.adding ? <><LoaderCircle className="animate-spin" /> Adding…</> : <><FolderPlus /> Add to T3 Code</>}
          </Button>
        </span>}
      </Field>
      {creating.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t create the T3 project</AlertTitle><AlertDescription>{creating.error}</AlertDescription></Alert>}
    </div>
  );
}

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew } = useWizardStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  return (
    <Group legend="T3 project" hint="Its threads run in this T3 project, whose folder is the repository’s main checkout.">
      {projects.projects.length === 0 && <p className="m-0 text-sm text-muted-foreground">T3 Code has no project yet.</p>}
      <RadioGroup value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => (id === 'new' ? chooseNew() : pick(id as string))} className="gap-2">
        {projects.projects.map((p) => {
          const reason = unpickable(p, run, { onboarding });
          const kept = p.onBoard && isOnboarding({ onboarding }, p.repo);
          return (
            <Choice key={p.id} value={p.id} disabled={!!reason} title={<span className="flex flex-wrap items-center gap-2">{p.name}
              {p.provider && <Badge variant="outline" size="sm">{p.provider}</Badge>}
              <ConfigBadge project={p} />
              {p.onBoard && <Badge variant="secondary" size="sm">{kept ? 'onboarding' : 'on the board'}</Badge>}</span>}>
              <span className="font-mono">{p.folder}</span>{p.repo ? ` · ${p.repo}` : ` · ${reason}`}{p.repo && kept && reason && ` · ${reason}`}
            </Choice>
          );
        })}
        <Choice value="new" title="Create a new T3 project">From a folder on this Mac that holds the repository’s main checkout.</Choice>
      </RadioGroup>
      {creating && <NewProject creating={creating} />}
    </Group>
  );
}

const SHOW_TITLES: Record<ShowSetting, string> = { all: 'All items', 'opted-in': 'Opted-in items' };

/** An item source as a line, like `GitHub Project maddec01 #3`. */
const sourceLine = (source: RepositoryItemSource, repo: string) => source.kind === 'github-project' ? `GitHub Project ${source.owner} #${source.number}` : `${repo}’s issues`;

/** The provider, from the origin's host, which onboarding can't change. */
function ProviderRow({ project }: { project: ProjectChoice }) {
  return (
    <div data-field="provider" className="grid gap-1.5">
      <span className="text-sm font-medium">Provider</span>
      <Badge variant="outline" className="justify-self-start">{project.provider}</Badge>
      <span className="text-xs text-muted-foreground">From the host of {project.repo}’s origin; it can’t be changed.</span>
    </div>
  );
}

/** The values of the .lar-factory.json onboarding reuses, which it doesn't ask again. */
function ReusedConfig({ project, config }: { project: ProjectChoice; config: NonNullable<ProjectChoice['config']> }) {
  return (
    <div className="grid gap-3">
      <Badge variant="info" className="justify-self-start">From .lar-factory.json on the default branch</Badge>
      <dl data-reused-config className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
        <dt className="text-muted-foreground">Provider</dt><dd className="m-0">{project.provider}</dd>
        <dt className="text-muted-foreground">Item source</dt><dd className="m-0">{sourceLine(config.itemSource, project.repo!)}</dd>
        <dt className="text-muted-foreground">Show</dt><dd className="m-0">{SHOW_TITLES[config.show]}</dd>
        <dt className="text-muted-foreground">Repository role</dt><dd className="m-0">{config.role}</dd>
      </dl>
      <p className="m-0 text-xs text-muted-foreground">Changing these waits for Edit in build #385.</p>
    </div>
  );
}

type TextAnswer = keyof ReturnType<typeof setupProblems>;

/**
 * The questions: item source, show setting with the suggested one marked, and Repository role. A text answer's problem
 * is muted help until its field is edited or left.
 */
function SetupQuestions({ project, setup }: { project: ProjectChoice; setup: SetupAnswers }) {
  const answer = useWizardStore((s) => s.answer);
  const suggested = suggestedShow(setup.itemSource);
  const problems = setupProblems(setup);
  const [touched, setTouched] = useState<ReadonlySet<TextAnswer>>(new Set());
  const touch = (key: TextAnswer) => { if (!touched.has(key)) setTouched(new Set([...touched, key])); };
  /** A text answer's problem, whether it's marked, and the handlers that mark it. */
  const textAnswer = (key: TextAnswer) => ({
    field: { problem: problems[key], invalid: touched.has(key) },
    control: { value: setup[key], onBlur: () => touch(key), onChange: (e: { target: { value: string } }) => { touch(key); answer({ [key]: e.target.value }); } },
  });
  const owner = textAnswer('projectOwner');
  const number = textAnswer('projectNumber');
  const role = textAnswer('role');
  return (<>
    <Group legend="Item source" hint="Where the board finds this repository’s items. It lists the items that can show.">
      <RadioGroup value={setup.itemSource} onValueChange={(v) => answer({ itemSource: v as SetupAnswers['itemSource'] })} className="gap-2">
        <Choice value="github-project" title="A GitHub Project">A Project named by its owner and number, which other repositories may name too.</Choice>
        <Choice value="issues" title="The repository’s issues">{project.repo}’s own issues, with no extra fields.</Choice>
      </RadioGroup>
    </Group>
    {setup.itemSource === 'github-project' && (<>
      <Field name="project-owner" label="Project owner" hint="The GitHub user or organization that owns the Project." {...owner.field}>
        {(described) => <Input font="mono" {...owner.control} {...described} />}
      </Field>
      <Field name="project-number" label="Project number" hint="The number in the Project’s URL, after /projects/." {...number.field}>
        {(described) => <Input font="mono" inputMode="numeric" placeholder="3" {...number.control} {...described} />}
      </Field>
    </>)}
    <Group legend="Show" hint="Which of the item source’s items show on the board.">
      <RadioGroup value={setup.show} onValueChange={(v) => answer({ show: v as ShowSetting })} className="gap-2">
        {(['all', 'opted-in'] as const).map((show) => (
          <Choice key={show} value={show} title={<span className="flex items-center gap-2">{SHOW_TITLES[show]}{suggested === show && <Badge variant="secondary" size="sm">Suggested</Badge>}</span>}>
            {show === 'all' ? 'Every open item from the item source; an item with no status counts as List.'
              : `Only items that carry a status show; someone opts an item in by giving it ${setup.itemSource === 'github-project' ? 'the List Status' : 'the status-list label'}.`}
          </Choice>
        ))}
      </RadioGroup>
    </Group>
    <Field name="role" label="Repository role" hint="What this repository is to the others." {...role.field}>
      {(described) => <Input placeholder="Web client that talks to the API server" {...role.control} {...described} />}
    </Field>
  </>);
}

function SetupStep({ run }: { run: Run }) {
  const projects = useWizardStore((s) => s.projects);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  if (project.config) return <ReusedConfig project={project} config={project.config} />;
  return (
    <div className="grid gap-6">
      <ProviderRow project={project} />
      {project.provider === 'Azure DevOps' ? (
        <Alert variant="info"><Info /><AlertTitle>Azure DevOps arrives in build #386</AlertTitle>
          <AlertDescription>Until then, onboarding offers no item source for a repository on Azure DevOps.</AlertDescription></Alert>
      ) : project.configProblem ? (
        <Problem title="Can’t reuse .lar-factory.json">{project.configProblem} Fix the file on {project.repo}’s default branch, then Retry.</Problem>
      ) : !asksSetup(project) ? (
        <Problem title="Can’t check .lar-factory.json">Couldn’t read whether {project.repo} has .lar-factory.json on its default branch.</Problem>
      ) : run.setup && <SetupQuestions project={project} setup={run.setup} />}
    </div>
  );
}

type CheckStatus = 'waiting' | 'running' | 'passed' | 'failed';

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'passed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/16 text-success"><Check className="size-3.5" /></span>;
    case 'failed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-destructive/16 text-destructive"><X className="size-3.5" /></span>;
    case 'running': return <LoaderCircle className="size-5 shrink-0 animate-spin text-info" />;
    default: return <span className="size-5 shrink-0 rounded-full border border-dashed" />;
  }
}

/** One check's row: its state and title, what it found, and for a failure its problem, fix and Retry. */
interface CheckRow {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
  problem?: string;
  fix?: ReactNode;
  command?: string;
  retry?: () => void;
}

const STATUS_TEXT: Record<CheckStatus, string> = { waiting: 'Waiting', running: 'Checking…', passed: 'Passed', failed: 'Failed' };

function CheckList({ title, rows }: { title: string; rows: CheckRow[] }) {
  return (
    <div className="grid gap-1">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
        {rows.map((row) => (
          <li key={row.id} data-check={row.id} data-status={row.status} className="grid gap-2 px-3 py-2">
            <div className="flex items-center gap-2.5 text-sm">
              <StatusIcon status={row.status} />
              <span className="font-medium">{row.title}</span>
              <span className="ml-auto text-xs text-muted-foreground">{row.status === 'passed' && row.detail || STATUS_TEXT[row.status]}</span>
            </div>
            {row.status === 'failed' && (
              <Alert variant="error"><CircleAlert /><AlertTitle>{row.problem}</AlertTitle>
                <AlertDescription><span>{row.fix}</span>
                  {row.command && <span className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.command}</code>
                    <CopyButton text={row.command} label={`Copy ${row.command}`} /></span>}
                </AlertDescription>
                {row.retry && <AlertAction><Button size="xs" variant="outline" onClick={row.retry}><RotateCw /> Retry</Button></AlertAction>}
              </Alert>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const COMMAND_TITLES: Record<(typeof COMMAND_CHECKS)[number], string> = { gh: 'gh login', t3: 't3 and T3 Code', git: 'git', jq: 'jq', curl: 'curl' };
const SETUP_TITLES: Record<SetupCheckId, string> = { checkout: 'T3 project is the main checkout', source: 'Item source can be read', push: 'gh can push to the repository' };

function ChecksStep({ run }: { run: Run }) {
  const { projects, checks, runChecks, retryCheck } = useWizardStore();
  const tools = useBoardStore((s) => s.data.tools);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  if (!checks) return null;
  const source = itemSourceOf(run, project);
  const retryAll = () => void runChecks();
  const commands = COMMAND_CHECKS.map((name): CheckRow => {
    const check = tools?.[name];
    if (checks.commands.state === 'running') return { id: name, title: COMMAND_TITLES[name], status: 'running' };
    if (commandPasses(name, tools, source)) return { id: name, title: COMMAND_TITLES[name], status: 'passed', detail: toolState(check, name === 'gh').text };
    return { id: name, title: COMMAND_TITLES[name], status: 'failed', problem: `${name}: ${toolState(check).text}`, fix: toolDescription('', check), retry: retryAll };
  });
  const setup = SETUP_CHECKS.map((id): CheckRow => {
    const check = checks.setup[id];
    if (check.state !== 'done') return { id, title: SETUP_TITLES[id], status: check.state };
    const { result } = check;
    return result.passed ? { id, title: SETUP_TITLES[id], status: 'passed', detail: result.detail }
      : { id, title: SETUP_TITLES[id], status: 'failed', problem: result.problem, fix: result.fix, command: result.command, retry: () => void retryCheck(id) };
  });
  const rows = [...commands, ...setup];
  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const caption = `${passed} of ${rows.length} passed${failed ? ` · ${failed} need you` : ''}`;
  return (
    <div className="grid gap-4">
      <Progress value={passed} max={rows.length} caption={caption} aria-label={caption} />
      {checks.commands.state === 'failed' && (
        <Alert variant="error"><CircleAlert /><AlertTitle>Can’t check the commands</AlertTitle><AlertDescription>{checks.commands.error}</AlertDescription>
          <AlertAction><Button size="xs" variant="outline" onClick={retryAll}><RotateCw /> Retry</Button></AlertAction></Alert>
      )}
      <CheckList title="Required commands" rows={commands} />
      <CheckList title="Setup" rows={setup} />
    </div>
  );
}

/** A Clash's edit, as the PR would make it: the lines it swaps, or the delete or rename of its file or folder. */
function EditPreview({ clash }: { clash: Clash }) {
  const { edit } = clash;
  return (
    <pre className="m-0 ml-7 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
      {edit.kind === 'lines' ? (<>
        {edit.remove.map((line, i) => <div key={`-${i}`} className="text-destructive-foreground">- {line}</div>)}
        {edit.add.map((line, i) => <div key={`+${i}`} className="text-success-foreground">+ {line}</div>)}
      </>) : edit.kind === 'delete' ? <div className="text-destructive-foreground">Delete {clash.file}</div>
        : <div>Rename {clash.file} to {edit.to}</div>}
    </pre>
  );
}

/** One Clash: its tick, file and line, reason and edit. */
function ClashRow({ clash, picks }: { clash: Clash; picks: Run['cleanup'] }) {
  const tick = useWizardStore((s) => s.tick);
  return (
    <li data-clash={clash.id} className="grid gap-2 px-3 py-2.5">
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox checked={ticked(clash, picks)} onCheckedChange={(on) => tick(clash.id, on)} className="mt-0.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-mono text-xs">{clash.file}{clash.line !== undefined && `:${clash.line}`}</span>
          <span className="text-xs text-muted-foreground">{clash.reason}</span>
        </span>
      </label>
      <EditPreview clash={clash} />
    </li>
  );
}

/** A project skill named like a bundled skill: Delete it in the PR, or Rename it, with what Next waits for. */
function SkillClashPick({ skill, picks, clashes }: { skill: SkillClash; picks: Run['cleanup']; clashes: Extract<Clashes, { state: 'read' }> }) {
  const pickSkill = useWizardStore((s) => s.pickSkill);
  const pick = picks?.skills[skill.path];
  const problem = skillProblem(skill, picks, clashes);
  const name = pick?.kind === 'rename' ? pick.name : '';
  // A name restored on Resume counts as typed, so its problem shows as an error straight away.
  const [typed, setTyped] = useState(name !== '');
  return (
    <Alert data-skill-clash={skill.path} variant={problem ? 'warning' : 'default'}><CircleAlert />
      <AlertTitle>Project skill <span className="font-mono">{skill.name}</span> is named like a bundled skill</AlertTitle>
      <AlertDescription>
        <span><span className="font-mono">{skill.path}</span> would shadow the factory’s <span className="font-mono">{skill.name}</span>. Onboarding can’t go on until you pick one:</span>
        <RadioGroup value={pick?.kind ?? ''} onValueChange={(kind) => pickSkill(skill.path, kind === 'delete' ? { kind } : { kind: 'rename', name })} className="mt-1 gap-2">
          <label data-skill-pick="delete" className="flex items-center gap-2 text-sm text-foreground"><Radio value="delete" /> Delete it in the PR</label>
          <label data-skill-pick="rename" className="flex items-center gap-2 text-sm text-foreground"><Radio value="rename" /> Rename it</label>
        </RadioGroup>
        {pick?.kind === 'rename' && (
          <div className="mt-1 w-full text-foreground">
            <Field name="skill-name" label="New skill name" problem={problem ?? undefined} invalid={typed}
              hint={<>The PR moves it to <span className="font-mono">{skillsDir(skill.path)}{isSkillName(name) ? name : '…'}/</span> and sets <span className="font-mono">name:</span> in its SKILL.md.</>}>
              {(described) => <Input size="sm" font="mono" value={name} {...described} onBlur={() => setTyped(true)}
                onChange={(e) => { setTyped(true); pickSkill(skill.path, { kind: 'rename', name: e.target.value }); }} />}
            </Field>
          </div>
        )}
        {problem && pick?.kind !== 'rename' && <span data-problem className="text-xs">{problem}</span>}
      </AlertDescription>
    </Alert>
  );
}

/**
 * A path and what happens to it: side by side from `sm` up, the path kept whole; stacked below, where a long path
 * breaks anywhere rather than pushing the row wider.
 */
function PathAndWhat({ path, what }: { path: string; what: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="font-mono text-xs break-all sm:shrink-0 sm:break-normal">{path}</span>
      <span className="min-w-0 text-xs text-muted-foreground">{what}</span>
    </span>
  );
}

/** What the PR writes whatever is ticked; a reused .lar-factory.json stays as it is. */
function AlwaysWritten({ reused }: { reused: boolean }) {
  const rows = [
    { file: '## Agent skills', what: 'In CLAUDE.md if the repository has one, else in AGENTS.md; replaces the block where one is.' },
    { file: 'docs/agents/issue-tracker.md', what: 'Where the factory tracks issues; replaces the file if there is one.' },
    { file: 'docs/agents/triage-labels.md', what: 'The factory’s labels and triage roles; replaces the file if there is one.' },
    { file: 'docs/agents/domain.md', what: 'Where the domain docs live; replaces the file if there is one.' },
    { file: '.lar-factory.json', what: reused ? 'Kept as it is.' : 'The Repository config: role, item source and show setting.' },
  ];
  return (
    <div data-always-written className="grid gap-1">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Always written</h4>
      <ul className="m-0 grid list-none gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
        {rows.map((row) => (
          <li key={row.file} data-written={row.file} className="flex items-start gap-2"><Lock className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <PathAndWhat path={row.file} what={row.what} /></li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The fixed checks' Clashes, each with its edit to tick, and Delete or Rename for each project skill named like a
 * bundled skill, which Next waits for; then what the PR always writes. A failed run shows the board's problem with Retry.
 */
function CleanupStep({ run }: { run: Run }) {
  const { projects, clashes, finishing, findClashes } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  return (
    <div data-cleanup-step className="grid gap-6">
      <p className="m-0 text-sm text-muted-foreground">Fixed checks look on {project.repo}’s default branch for known Clashes: things that make agents work against the factory. Only the edits you tick go into the PR.</p>
      {(!clashes || clashes.state === 'reading') ? (
        <p data-reading-clashes className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Running the fixed checks…</p>
      ) : clashes.state === 'failed' ? (
        <Alert variant="error"><CircleAlert /><AlertTitle>Can’t run the fixed checks</AlertTitle><AlertDescription>{clashes.error}</AlertDescription>
          <AlertAction><Button size="xs" variant="outline" onClick={() => void findClashes()}><RotateCw /> Retry</Button></AlertAction></Alert>
      ) : (<>
        {clashes.found.skillClashes.map((skill) => <SkillClashPick key={skill.path} skill={skill} picks={run.cleanup} clashes={clashes} />)}
        <div className="grid gap-1">
          <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixed checks</h4>
          {clashes.found.clashes.length
            ? <ul className="m-0 list-none divide-y rounded-lg border p-0">{clashes.found.clashes.map((clash) => <ClashRow key={clash.id} clash={clash} picks={run.cleanup} />)}</ul>
            : <p className="m-0 text-sm text-muted-foreground">The fixed checks found no Clash.</p>}
        </div>
      </>)}
      <AlwaysWritten reused={!!project.config} />
      {finishing.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t finish onboarding</AlertTitle><AlertDescription>{finishing.error}</AlertDescription></Alert>}
    </div>
  );
}

/** The PR's place, `owner/name#n`, from its URL. */
const prName = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#');

/**
 * The PR that adds .lar-factory.json: what it adds, Open the PR, then the wait for its merge, which the board finishes.
 * A PR closed without merging offers Reopen PR and Start over.
 */
function PrStep({ run }: { run: Run }) {
  const { projects, pr, openPr, reopenPr, startOver, checkMerge } = useWizardStore();
  const data = useBoardStore((s) => s.data);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  const config = project && configOf(run, project);
  if (!project?.repo || !config) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  const { repo } = project;
  if (run.prUrl && onboarded(run, data)) {
    return (
      <div data-pr-step>
        <Alert variant="success"><Check /><AlertTitle>{repo} is onboarded</AlertTitle>
          <AlertDescription>{prName(run.prUrl)} merged. The board reads {repo}’s items from its item source, and Start build and Start refining work for them.</AlertDescription></Alert>
      </div>
    );
  }
  return (
    <div data-pr-step className="grid gap-4">
      <div className="grid gap-1">
        <h4 className="m-0 text-xs font-medium text-muted-foreground">One PR on {repo}, branch lar-factory/onboarding</h4>
        <p className="m-0 text-xs text-muted-foreground">It adds .lar-factory.json, made on GitHub from the default branch, so your checkout stays as it is. When the branch is taken, its open PR is reused, and with none the PR comes from the first free lar-factory/onboarding-2, -3 and on.</p>
        <pre className="m-0 overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">{onboardingConfigFile(config)}</pre>
      </div>
      {run.prUrl && prClosed(run, data) ? (
        <Alert variant="warning" data-pr-closed><CircleAlert /><AlertTitle>{prName(run.prUrl)} closed without merging</AlertTitle>
          <AlertDescription>
            <span>Reopen PR reopens it and waits for its merge again. Start over opens a new PR.</span>
            {pr.error && <span className="text-destructive-foreground">{pr.error}</span>}
          </AlertDescription>
          <AlertAction>
            <Button size="xs" variant="outline" disabled={pr.reopening || pr.opening} onClick={() => void reopenPr()}>
              {pr.reopening ? <LoaderCircle className="animate-spin" /> : <RotateCw />} Reopen PR</Button>
            <Button size="xs" variant="outline" disabled={pr.reopening || pr.opening} onClick={() => void startOver()}><GitPullRequest /> Start over</Button>
          </AlertAction></Alert>
      ) : run.prUrl ? (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2.5 text-sm">
            <LoaderCircle className="size-4 animate-spin text-info" />
            <span><a className="font-medium underline" href={run.prUrl} target="_blank" rel="noreferrer">{prName(run.prUrl)}</a> is open. Waiting for its merge.</span>
            <Button size="xs" variant="outline" className="ml-auto" disabled={pr.checking} onClick={() => void checkMerge()}>
              {pr.checking ? <><LoaderCircle className="animate-spin" /> Checking…</> : <><RotateCw /> Check now</>}</Button>
          </div>
          {pr.checkedAt !== null && !pr.checking && !pr.error && (
            <p data-checked className="m-0 text-xs text-muted-foreground" role="status">Checked {new Date(pr.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: still open.</p>
          )}
          {pr.error && (
            <Alert variant="error"><CircleAlert /><AlertTitle>Can’t check the PR</AlertTitle><AlertDescription>{pr.error}</AlertDescription>
              <AlertAction><Button size="xs" variant="outline" disabled={pr.checking} onClick={() => void checkMerge()}><RotateCw /> Retry</Button></AlertAction></Alert>
          )}
          <p className="m-0 text-xs text-muted-foreground">You can close this dialog: {repo} stays on the board as onboarding, with Resume, and Start build and Start refining stay disabled for its items. The board finishes onboarding on its next check after the merge; Check now checks at once.</p>
        </div>
      ) : pr.error ? (
        <Alert variant="error"><CircleAlert /><AlertTitle>Can’t open the PR</AlertTitle><AlertDescription>{pr.error}</AlertDescription>
          <AlertAction><Button size="xs" variant="outline" disabled={pr.opening} onClick={() => void openPr()}><RotateCw /> Retry</Button></AlertAction></Alert>
      ) : (
        <Button className="justify-self-start" disabled={pr.opening} onClick={() => void openPr()}>
          {pr.opening ? <><LoaderCircle className="animate-spin" /> Opening the PR…</> : <><GitPullRequest /> Open the PR</>}</Button>
      )}
    </div>
  );
}

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  if (step === 'project') return <ProjectStep run={run} />;
  if (step === 'setup') return <SetupStep run={run} />;
  if (step === 'checks') return <ChecksStep run={run} />;
  if (step === 'cleanup') return <CleanupStep run={run} />;
  return <PrStep run={run} />;
}
