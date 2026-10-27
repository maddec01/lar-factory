// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. The Labels step lists each workflow label, and for a repository that reads its issues
// each status label, with whether the repository has it, the custom labels to pick, then the labels it leaves alone. The
// Cleanup step lists each Clash the fixed checks find, with its edit to tick, and asks Delete or Rename for each project
// skill named like a bundled skill. Its Clash agent asks for a provider and model, then shows its run's latest message
// and thread, and the agent's Clashes once the run is done, or why it ended without them with Retry, which starts a new
// thread. The Pull request step lists what the PR changes, opens it, then waits for its merge.

import { useEffect, useState, type ReactNode } from 'react';
import { Check, CircleAlert, ExternalLink, FileText, FolderPlus, GitPullRequest, Info, LoaderCircle, Lock, RotateCw, Search, X } from 'lucide-react';
import {
  SETUP_CHECKS, customLabelChoices, customLabelProblem, isOnboarding, isSkillName, labelsToCreate, onboardingConfigFile, threadLink, type Clash, type ClashRun, type LabelPlan, type LabelRow,
  type LeftAloneLabel, type ModelChoice, type ModelGroup, type OnboardingPrChange, type ProjectChoice, type RepositoryItemSource, type SetupCheckId,
  type SkillClash,
} from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Checkbox } from '@lar-factory/ui/checkbox';
import { Input } from '@lar-factory/ui/input';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { Progress } from '@lar-factory/ui/progress';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { useBoardStore } from '../board/board-store.ts';
import { CopyButton } from '../copy/copy-button.tsx';
import { toolDescription, toolState } from '../settings/settings-pages.tsx';
import { CUSTOM_LABELS_HELP, Choice, CustomLabelPicker, CustomLabelsTitle, Field, Group, SHOW_TITLES, SetupFields } from './setup-fields.tsx';
import {
  COMMAND_CHECKS, type Clashes, type Creating, type Labels, type Run, type StepId, asksSetup, commandPasses, configOf, customLabelsToCreate, itemSourceOf, labelsPlan, latestRun,
  nextModel, onboarded, pickedProject, picksOf, prClosed, renaming, skillProblem, skillsDir, ticked, unpickable, useWizardStore,
} from './wizard-store.ts';

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
      <p className="m-0 text-xs text-muted-foreground">To change these once onboarding finishes, use Edit in Settings › Repositories.</p>
    </div>
  );
}

function SetupStep({ run }: { run: Run }) {
  const { projects, answer } = useWizardStore();
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
      ) : run.setup && <SetupFields repo={project.repo} setup={run.setup} onAnswer={answer} />}
    </div>
  );
}

/** One label the step needs: its name and what it does, then whether the repository has it, or Rename for its old name. */
function LabelItem({ row, labels }: { row: LabelRow; labels: Labels }) {
  const toggleRename = useWizardStore((s) => s.toggleRename);
  return (
    <li data-label={row.label.name} data-state={row.state} className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: `#${row.label.color}` }} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="font-mono font-medium break-all">{row.label.name}</span>
        <span className="text-xs text-muted-foreground">{row.label.description}</span></span>
      {row.state === 'rename' ? (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={!labels.kept.includes(row.oldName)} disabled={!!labels.busy} onCheckedChange={() => toggleRename(row.oldName)} />
          Rename <code className="font-mono break-all">{row.oldName}</code>
        </label>
      ) : <Badge variant={row.state === 'present' ? 'success' : 'warning'} size="sm">{row.state}</Badge>}
    </li>
  );
}

function LabelList({ title, note, rows, labels }: { title: string; note?: string; rows: LabelRow[]; labels: Labels }) {
  return (
    <div className="grid gap-1">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {note && <p className="m-0 text-xs text-muted-foreground">{note}</p>}
      <ul className="m-0 grid list-none divide-y rounded-lg border p-0">{rows.map((row) => <LabelItem key={row.label.name} row={row} labels={labels} />)}</ul>
    </div>
  );
}

/**
 * The labels the step changes nothing on, less the custom labels it lists; an old name beside its new label keeps its
 * issues until the user moves them.
 */
function LeftAlone({ labels }: { labels: LeftAloneLabel[] }) {
  if (!labels.length) return null;
  return (
    <div data-left-alone className="grid gap-1">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Left alone</h4>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {labels.map((l) => (
          <li key={l.name} data-left={l.name} className="min-w-0 break-all"><code className="font-mono">{l.name}</code>
            {l.keptBeside && <span className="text-xs text-muted-foreground"> · The repository has {l.keptBeside} too, so it can’t be renamed. Its issues keep {l.name} until you move them to {l.keptBeside}.</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The custom labels: a reused .lar-factory.json's, listed; else the custom label picker, whose Add creates the typed
 * label on the repository and picks it.
 */
function CustomLabels({ run, project, plan, labels }: { run: Run; project: ProjectChoice; plan: LabelPlan; labels: Labels }) {
  const { toggleCustomLabel, typeCustomLabel, addCustomLabel } = useWizardStore();
  if (project.config) {
    const { labels: names } = project.config;
    const missing = customLabelsToCreate(project, labels);
    return (
      <div data-custom-labels className="grid gap-1">
        <CustomLabelsTitle />
        <p className="m-0 text-xs text-muted-foreground">{CUSTOM_LABELS_HELP} These are the ones {project.repo}’s .lar-factory.json lists; change them with Edit in Settings › Repositories once onboarding finishes. Create makes the missing ones, with GitHub’s colour, but none that can’t be a custom label.</p>
        {names.length ? (
          <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
            {names.map((name) => {
              const problem = customLabelProblem(name);
              const state = problem ? 'problem' : missing.includes(name) ? 'missing' : 'present';
              return (
                <li key={name} data-custom={name} data-state={state} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <code className="break-all font-mono">{name}</code>
                    {problem && <span data-problem className="text-xs text-destructive-foreground">{problem}</span>}
                  </span>
                  <Badge variant={state === 'present' ? 'success' : state === 'missing' ? 'warning' : 'error'} size="sm">
                    {problem ? 'can’t create' : state}</Badge>
                </li>
              );
            })}
          </ul>
        ) : <p className="m-0 text-sm text-muted-foreground">It lists none.</p>}
      </div>
    );
  }
  return (
    <CustomLabelPicker repo={project.repo!} offered={customLabelChoices(plan)} picked={run.customLabels} typed={labels.typed} adding={labels.busy === 'custom'} busy={!!labels.busy}
      error={labels.error?.action === 'custom' ? labels.error : null} onToggle={toggleCustomLabel} onType={typeCustomLabel} onAdd={() => void addCustomLabel()} />
  );
}

const STATUS_LABELS_NOTE = 'The board keeps each item’s status in one of these labels, as build #379 set up. Create makes the missing ones, but Next doesn’t wait for them.';

/**
 * The Labels step: each workflow label with what it does and whether the repository has it, the status labels for
 * a repository that reads its issues, Create and Rename, the custom labels, then the labels it leaves alone. On Azure DevOps it waits for
 * build #386.
 */
function LabelsStep({ run }: { run: Run }) {
  const { projects, labels, loadLabels, createLabels, renameLabels } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  if (project.provider === 'Azure DevOps') {
    return <Alert variant="info" data-labels-azure><Info /><AlertTitle>Azure DevOps tags arrive in build #386</AlertTitle>
      <AlertDescription>Until then this step creates no tag on Azure DevOps, and Next goes on.</AlertDescription></Alert>;
  }
  if (!labels || labels.read.state === 'loading') {
    return <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading {project.repo}’s labels…</p>;
  }
  if (labels.read.state === 'failed') {
    return <Alert variant="error"><CircleAlert /><AlertTitle>Can’t read {project.repo}’s labels</AlertTitle><AlertDescription>{labels.read.error}</AlertDescription>
      <AlertAction><Button size="xs" variant="outline" onClick={() => void loadLabels()}><RotateCw /> Retry</Button></AlertAction></Alert>;
  }
  const plan = labelsPlan(run, project, labels)!;
  const creates = labelsToCreate(plan, renaming(plan, labels)).length + customLabelsToCreate(project, labels).length;
  // The custom labels the step lists as picked, a reused file's or the run's, which Left alone leaves out.
  const chosen = new Set((project.config?.labels ?? run.customLabels).map((l) => l.toLowerCase()));
  const renames = renaming(plan, labels).length;
  const retry = labels.error?.action === 'rename' ? renameLabels : createLabels;
  return (
    <div className="grid gap-4">
      <p className="m-0 text-xs text-muted-foreground">lar-work and the board read these labels on {project.repo}. Next waits until it has every workflow label. A rename keeps the label on every issue that carries it.</p>
      <LabelList title="Workflow labels" rows={plan.workflow} labels={labels} />
      {plan.status.length > 0 && <LabelList title="Status labels" note={STATUS_LABELS_NOTE} rows={plan.status} labels={labels} />}
      {(creates > 0 || renames > 0) && <div className="flex gap-2">
        {creates > 0 && <Button data-create-labels size="sm" disabled={!!labels.busy} onClick={() => void createLabels()}>
          {labels.busy === 'create' ? <><LoaderCircle className="animate-spin" /> Creating…</> : `Create ${creates} missing`}</Button>}
        {renames > 0 && <Button data-rename-labels size="sm" variant="outline" disabled={!!labels.busy} onClick={() => void renameLabels()}>
          {labels.busy === 'rename' ? <><LoaderCircle className="animate-spin" /> Renaming…</> : `Rename ${renames}`}</Button>}
      </div>}
      {labels.error && labels.error.action !== 'custom' && (
        <Alert variant="error"><CircleAlert /><AlertTitle>{labels.error.action === 'create' ? 'Can’t create the labels' : 'Can’t rename the labels'}</AlertTitle>
          <AlertDescription>{labels.error.message}</AlertDescription>
          <AlertAction><Button size="xs" variant="outline" disabled={!!labels.busy} onClick={() => void retry()}><RotateCw /> Retry</Button></AlertAction></Alert>
      )}
      <CustomLabels run={run} project={project} plan={plan} labels={labels} />
      <LeftAlone labels={plan.leftAlone.filter((l) => !labels.created.includes(l.name) && !chosen.has(l.name.toLowerCase()))} />
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

/** A Clash's edit, as the PR would make it: the lines it swaps, or the delete or rename of its file or folder; dimmed when it won't apply. */
function EditPreview({ clash }: { clash: Clash }) {
  const { edit } = clash;
  return (
    <pre data-edit-preview className={`m-0 ml-7 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs ${clash.wontApply ? 'opacity-60' : ''}`}>
      {edit.kind === 'lines' ? (<>
        {edit.remove.map((line, i) => <div key={`-${i}`} className="text-destructive-foreground">- {line}</div>)}
        {edit.add.map((line, i) => <div key={`+${i}`} className="text-success-foreground">+ {line}</div>)}
      </>) : edit.kind === 'delete' ? <div className="text-destructive-foreground">Delete {clash.file}</div>
        : <div>Rename {clash.file} to {edit.to}</div>}
    </pre>
  );
}

/** One Clash: its tick, file and line, reason and edit; an edit that won't apply is unticked, can't be ticked and says why. */
function ClashRow({ clash, picks }: { clash: Clash; picks: Run['cleanup'] }) {
  const tick = useWizardStore((s) => s.tick);
  return (
    <li data-clash={clash.id} className="grid gap-2 px-3 py-2.5">
      <label className={`flex items-start gap-2.5 ${clash.wontApply ? '' : 'cursor-pointer'}`}>
        <Checkbox checked={ticked(clash, picks)} disabled={!!clash.wontApply} onCheckedChange={(on) => tick(clash.id, on)} className="mt-0.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-mono text-xs">{clash.file}{clash.line !== undefined && `:${clash.line}`}</span>
          <span className="text-xs text-muted-foreground">{clash.reason}</span>
          {clash.wontApply && <span data-wont-apply className="text-xs text-warning-foreground">Won’t go in the PR: {clash.wontApply}</span>}
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

/** A model choice as T3's picker names it, such as `Claude Opus 4.7`; its ids when T3 no longer offers it. */
function modelName(groups: readonly ModelGroup[], choice: ModelChoice): string {
  const group = groups.find((g) => g.instanceId === choice.instanceId);
  const model = group?.models.find((m) => m.slug === choice.model);
  return group && model ? `${group.name} ${model.label}` : `${choice.instanceId} ${choice.model}`;
}

/** Opens a run's T3 thread in T3 Code, or a disabled button whose title says why it can't yet. */
function ThreadLink({ run }: { run: ClashRun }) {
  const environment = useBoardStore((s) => s.data.t3EnvironmentId);
  const reason = !run.threadId ? 'T3 Code hasn’t listed the thread yet' : !environment ? 'T3 Code hasn’t written its environment id' : null;
  // Pointer events stay on while it's disabled, so its title says why.
  return reason
    ? <Button size="xs" variant="ghost" className="disabled:pointer-events-auto" data-thread-link disabled title={reason}><ExternalLink /> Open thread</Button>
    : <Button size="xs" variant="ghost" data-thread-link render={<a href={threadLink(environment!, run.threadId!)} />}><ExternalLink /> Open thread</Button>;
}

/** Why a run ended without Clashes, by its state. */
const ENDED: Record<'failed' | 'timed-out' | 'waiting', string> = {
  failed: 'The Clash agent’s run failed',
  'timed-out': 'The Clash agent’s run timed out',
  waiting: 'The Clash agent is waiting for an answer',
};

/** How an earlier run ended, by its state. */
const EARLIER: Record<ClashRun['state'], string> = { running: 'running', done: 'done', failed: 'failed', 'timed-out': 'timed out', waiting: 'waiting for an answer' };

/** The provider and model the next run starts on, as two selects of what T3 offers. */
function ModelPicker({ model, disabled }: { model: ModelChoice | null; disabled: boolean }) {
  const groups = useBoardStore((s) => s.data.modelChoices);
  // The board reads T3's models as it first reads GitHub, so before that read ends it has none to offer yet.
  const read = useBoardStore((s) => s.data.fetchedAt !== null || s.data.error !== null);
  const pickModel = useWizardStore((s) => s.pickModel);
  if (!groups.length && !read) {
    return <p data-reading-models className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading T3 Code’s models…</p>;
  }
  if (!groups.length) return <p className="m-0 text-sm text-muted-foreground">T3 Code offers no provider with a model. Turn one on in T3 Code’s settings.</p>;
  const group = groups.find((g) => g.instanceId === model?.instanceId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="agent-provider" label="Provider" hint="The provider whose T3 thread looks for Clashes.">
        {(described) => <NativeSelect value={model?.instanceId ?? ''} disabled={disabled} {...described} onChange={(e) => {
          const picked = groups.find((g) => g.instanceId === e.target.value);
          if (picked?.models[0]) pickModel({ instanceId: picked.instanceId, model: picked.models[0].slug });
        }}>
          {!group && <option value={model?.instanceId ?? ''} disabled>{model ? model.instanceId : 'Pick a provider'}</option>}
          {groups.map((g) => <option key={g.instanceId} value={g.instanceId}>{g.name}</option>)}
        </NativeSelect>}
      </Field>
      <Field name="agent-model" label="Model" hint="The model the thread runs on.">
        {(described) => <NativeSelect value={model?.model ?? ''} disabled={disabled || !group} {...described}
          onChange={(e) => group && pickModel({ instanceId: group.instanceId, model: e.target.value })}>
          {!group?.models.some((m) => m.slug === model?.model) && <option value={model?.model ?? ''} disabled>{model?.model ?? 'Pick a model'}</option>}
          {group?.models.map((m) => <option key={m.slug} value={m.slug}>{m.label}</option>)}
        </NativeSelect>}
      </Field>
    </div>
  );
}

/**
 * The Clash agent: the provider and model, then Look for Clashes; the latest run's latest message while it runs, its
 * Clashes once it's done, or why it ended without them with Retry; then each earlier run with its thread.
 */
function ClashAgent({ run }: { run: Run }) {
  const { agent, lookForClashes, readClashRuns } = useWizardStore();
  const groups = useBoardStore((s) => s.data.modelChoices);
  const model = nextModel(agent, groups);
  const latest = latestRun(agent);
  const running = agent.starting || latest?.state === 'running';
  const look = () => model && void lookForClashes(model);
  const earlier = agent.runs?.slice(0, -1) ?? [];
  return (
    <div data-clash-agent className="grid gap-3">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Clash agent</h4>
      <p className="m-0 text-xs text-muted-foreground">An agent in a T3 thread in this repository’s project reads every instruction file on a fresh fetch of the default branch and reports rules that work against the factory’s. Next waits for its run. You can close this dialog while it runs: the run goes on, and Resume shows it.</p>
      <ModelPicker model={model} disabled={running} />
      {/* After a failed start the alert's Retry starts the run, so Look again doesn't offer a second way. */}
      {(!latest || latest.state === 'done') && agent.error?.call !== 'start' && (
        <Button data-look-for-clashes className="justify-self-start" variant={latest ? 'outline' : 'default'} disabled={!model || running} onClick={look}>
          {agent.starting ? <><LoaderCircle className="animate-spin" /> Starting…</> : <><Search /> {latest ? 'Look again' : 'Look for Clashes'}</>}</Button>
      )}
      {agent.error && (
        <Alert variant="error"><CircleAlert /><AlertTitle>Can’t reach the Clash agent</AlertTitle><AlertDescription>{agent.error.message}</AlertDescription>
          <AlertAction><Button size="xs" variant="outline" disabled={running} onClick={() => agent.error?.call === 'start' ? look() : void readClashRuns()}>
            <RotateCw /> Retry</Button></AlertAction></Alert>
      )}
      {latest?.state === 'running' ? (
        <div data-agent-run="running" className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LoaderCircle className="size-4 animate-spin text-info" /> Agent running on {modelName(groups, latest.model)}
            <span className="ml-auto"><ThreadLink run={latest} /></span>
          </div>
          <p data-agent-progress className="m-0 whitespace-pre-wrap text-xs text-muted-foreground">{latest.progress ?? 'Waiting for the agent’s first message.'}</p>
        </div>
      ) : latest?.state === 'done' ? (
        <div data-agent-run="done" className="grid gap-1">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-success" /> {modelName(groups, latest.model)} found {latest.clashes.length === 1 ? '1 Clash' : `${latest.clashes.length} Clashes`}
            <span className="ml-auto"><ThreadLink run={latest} /></span>
          </div>
          {latest.clashes.length
            ? <ul className="m-0 list-none divide-y rounded-lg border p-0">{latest.clashes.map((clash) => <ClashRow key={clash.id} clash={clash} picks={run.cleanup} />)}</ul>
            : <p className="m-0 text-sm text-muted-foreground">The agent found no Clash.</p>}
        </div>
      ) : latest && (
        <Alert data-agent-run={latest.state} variant={latest.state === 'failed' ? 'error' : 'warning'}><CircleAlert /><AlertTitle>{ENDED[latest.state]}</AlertTitle>
          <AlertDescription>{latest.why}</AlertDescription>
          <AlertAction><ThreadLink run={latest} />
            <Button size="xs" variant="outline" disabled={!model || running} onClick={look}>{agent.starting ? <LoaderCircle className="animate-spin" /> : <RotateCw />} Retry</Button>
          </AlertAction></Alert>
      )}
      {earlier.length > 0 && (
        <ul data-earlier-runs className="m-0 grid list-none gap-1 p-0 text-xs text-muted-foreground">
          {earlier.map((r) => (
            <li key={r.title} data-earlier-run={r.title} className="flex items-center gap-2">
              Earlier run on {modelName(groups, r.model)}: {EARLIER[r.state]}
              <ThreadLink run={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
 * bundled skill, which Next waits for; then the Clash agent and what the PR always writes. A failed run shows the board's problem with Retry.
 */
function CleanupStep({ run }: { run: Run }) {
  const { projects, clashes, findClashes } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  return (
    <div data-cleanup-step className="grid gap-6">
      <p className="m-0 text-sm text-muted-foreground">Fixed checks look on {project.repo}’s default branch for known Clashes: things that make agents work against the factory. Then the Clash agent looks for the rest. Only the edits you tick go into the PR.</p>
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
      <ClashAgent run={run} />
      <AlwaysWritten reused={!!project.config} />
    </div>
  );
}

/** The PR's place, `owner/name#n`, from its URL. */
export const prName = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#');

/** A change of the PR as its list shows it: the path, then what the PR does to it. */
function changeRow(change: OnboardingPrChange): { path: string; what: string } {
  if (change.kind === 'agent-skills') return { path: change.path, what: 'Writes the ## Agent skills block.' };
  if (change.kind === 'write') return { path: change.path, what: change.created ? 'Adds the file.' : 'Replaces the file.' };
  if (change.kind === 'edit') return { path: change.path, what: `Edits line ${change.line}: ${change.reason}` };
  if (change.kind === 'delete') return { path: change.path, what: 'Deletes it.' };
  return { path: change.path, what: `Renames it to ${change.to}` };
}

/** What the PR changes against the default branch, as the board previews it, with Retry when the board can't. */
function PrChangeList() {
  const { changes, readPrChanges } = useWizardStore();
  if (!changes || changes.state === 'reading') {
    return <p data-reading-changes className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Reading what the PR changes…</p>;
  }
  if (changes.state === 'failed') {
    return <Alert variant="error"><CircleAlert /><AlertTitle>Can’t list the PR’s changes</AlertTitle><AlertDescription>{changes.error}</AlertDescription>
      <AlertAction><Button size="xs" variant="outline" onClick={() => void readPrChanges()}><RotateCw /> Retry</Button></AlertAction></Alert>;
  }
  return (
    <ul data-pr-changes className="m-0 grid list-none gap-1 rounded-lg border p-3 text-sm">
      {changes.changes.map(changeRow).map((row, i) => (
        <li key={i} data-change={row.path} className="flex items-start gap-2"><FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <PathAndWhat path={row.path} what={row.what} /></li>
      ))}
    </ul>
  );
}

/**
 * The PR: what it changes, Open the PR with the Cleanup step's picks, then the wait for its merge, which the board
 * finishes. A PR closed without merging offers Reopen PR and Start over.
 */
function PrStep({ run }: { run: Run }) {
  const { projects, clashes, agent, changes, pr, openPr, reopenPr, startOver, checkMerge, readPrChanges } = useWizardStore();
  const data = useBoardStore((s) => s.data);
  // An open PR's body lists its changes, so the step shows neither the list nor the file it writes until the PR closes.
  const listed = !run.prUrl || prClosed(run, data);
  // Resumed, the step has read no changes, nor the picks they need; with the PR open, it reads them once the PR closes.
  useEffect(() => {
    if (projects.state === 'loaded' && listed && changes === null) void readPrChanges();
  }, [projects.state, listed, changes, readPrChanges]);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  const config = project && (project.config ?? configOf(run, project));
  if (!project?.repo || !config) return <p className="m-0 text-sm text-muted-foreground">T3 Code no longer has the picked project. Go Back and pick one.</p>;
  const { repo } = project;
  // Open the PR waits for its changes to be listed, so the PR holds only what the step shows.
  const openable = !pr.opening && !!picksOf(run, clashes, agent) && changes?.state === 'read';
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
        <p className="m-0 text-xs text-muted-foreground">Its one commit is made on GitHub from the default branch, so your checkout stays as it is. When the branch is taken, its open PR is reused, and with none the PR comes from the first free lar-factory/onboarding-2, -3 and on.</p>
        {listed && (<>
          <PrChangeList />
          {!project.config && <pre className="m-0 overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">{onboardingConfigFile(config)}</pre>}
        </>)}
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
            <Button size="xs" variant="outline" disabled={pr.reopening || !openable} onClick={() => void startOver()}><GitPullRequest /> Start over</Button>
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
          <AlertAction><Button size="xs" variant="outline" disabled={!openable} onClick={() => void openPr()}><RotateCw /> Retry</Button></AlertAction></Alert>
      ) : (
        <Button className="justify-self-start" disabled={!openable} onClick={() => void openPr()}>
          {pr.opening ? <><LoaderCircle className="animate-spin" /> Opening the PR…</> : <><GitPullRequest /> Open the PR</>}</Button>
      )}
    </div>
  );
}

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  if (step === 'project') return <ProjectStep run={run} />;
  if (step === 'setup') return <SetupStep run={run} />;
  if (step === 'labels') return <LabelsStep run={run} />;
  if (step === 'checks') return <ChecksStep run={run} />;
  if (step === 'cleanup') return <CleanupStep run={run} />;
  return <PrStep run={run} />;
}
