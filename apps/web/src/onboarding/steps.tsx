// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. The T3 project, Provider and item source, and Checks steps are filled in; the Pull
// request step's slice fills in its own.

import type { ReactNode } from 'react';
import { Check, CircleAlert, FolderPlus, Info, LoaderCircle, RotateCw, X } from 'lucide-react';
import { SETUP_CHECKS, type ProjectChoice, type RepositoryItemSource, type SetupAnswers, type SetupCheckId, type ShowSetting } from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { Progress } from '@lar-factory/ui/progress';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { useBoardStore } from '../board/board-store.ts';
import { CopyButton } from '../copy/copy-button.tsx';
import { toolDescription, toolState } from '../settings/settings-pages.tsx';
import {
  COMMAND_CHECKS, type Checks, type Creating, type Run, type StepId, asksSetup, commandPasses, itemSourceOf, pickedProject, suggestedShow, unpickable,
  useWizardStore,
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

/** One field on its own row: its label, the control, then one line of help. */
function Field({ name, label, hint, children }: { name?: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return <label data-field={name} className="grid gap-1.5"><span className="text-sm font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>;
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
        <span className="flex gap-2">
          <Input data-new-folder font="mono" placeholder="~/Developer/lar-web" value={creating.folder} disabled={creating.adding}
            onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Button data-add-project variant="outline" disabled={creating.adding || !creating.folder.trim()} onClick={add}>
            {creating.adding ? <><LoaderCircle className="animate-spin" /> Adding…</> : <><FolderPlus /> Add to T3 Code</>}
          </Button>
        </span>
      </Field>
      {creating.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t create the T3 project</AlertTitle><AlertDescription>{creating.error}</AlertDescription></Alert>}
    </div>
  );
}

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  return (
    <Group legend="T3 project" hint="Its threads run in this T3 project, whose folder is the repository’s main checkout.">
      {projects.projects.length === 0 && <p className="m-0 text-sm text-muted-foreground">T3 Code has no project yet.</p>}
      <RadioGroup value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => (id === 'new' ? chooseNew() : pick(id as string))} className="gap-2">
        {projects.projects.map((p) => {
          const reason = unpickable(p, run);
          return (
            <Choice key={p.id} value={p.id} disabled={!!reason} title={<span className="flex flex-wrap items-center gap-2">{p.name}
              {p.provider && <Badge variant="outline" size="sm">{p.provider}</Badge>}
              <ConfigBadge project={p} />
              {p.onBoard && <Badge variant="secondary" size="sm">on the board</Badge>}</span>}>
              <span className="font-mono">{p.folder}</span>{p.repo ? ` · ${p.repo}` : ` · ${reason}`}
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

/** The questions: item source, show setting with the suggested one marked, and Repository role. */
function SetupQuestions({ project, setup }: { project: ProjectChoice; setup: SetupAnswers }) {
  const answer = useWizardStore((s) => s.answer);
  const suggested = suggestedShow(setup.itemSource);
  return (<>
    <Group legend="Item source" hint="Where the board finds this repository’s items. It lists the items that can show.">
      <RadioGroup value={setup.itemSource} onValueChange={(v) => answer({ itemSource: v as SetupAnswers['itemSource'] })} className="gap-2">
        <Choice value="github-project" title="A GitHub Project">A Project named by its owner and number, which other repositories may name too.</Choice>
        <Choice value="issues" title="The repository’s issues">{project.repo}’s own issues, with no extra fields.</Choice>
      </RadioGroup>
    </Group>
    {setup.itemSource === 'github-project' && (<>
      <Field name="project-owner" label="Project owner" hint="The GitHub user or organization that owns the Project.">
        <Input font="mono" value={setup.projectOwner} onChange={(e) => answer({ projectOwner: e.target.value })} />
      </Field>
      <Field name="project-number" label="Project number" hint="The number in the Project’s URL, after /projects/.">
        <Input font="mono" inputMode="numeric" placeholder="3" value={setup.projectNumber} onChange={(e) => answer({ projectNumber: e.target.value })} />
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
    <Field name="role" label="Repository role" hint="What this repository is to the others.">
      <Input placeholder="Web client that talks to the API server" value={setup.role} onChange={(e) => answer({ role: e.target.value })} />
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
      <FinishProblem checks={checks} />
    </div>
  );
}

/** Why Finish couldn't put the repository on the board. */
function FinishProblem({ checks }: { checks: Checks }) {
  if (!checks.finishError) return null;
  return <Alert variant="error"><CircleAlert /><AlertTitle>Can’t finish onboarding</AlertTitle><AlertDescription>{checks.finishError}</AlertDescription></Alert>;
}

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  if (step === 'project') return <ProjectStep run={run} />;
  if (step === 'setup') return <SetupStep run={run} />;
  if (step === 'checks') return <ChecksStep run={run} />;
  return <p className="m-0 text-sm text-muted-foreground">This step comes in a later part of build #382.</p>;
}
