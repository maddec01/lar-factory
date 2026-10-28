// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. The Labels step lists each workflow label, and for a repository that reads its issues
// each status label, with whether the repository has it, the custom labels to pick, then the labels it leaves alone. The
// Cleanup step lists each Clash the fixed checks find, with its edit to tick, and asks Delete or Rename for each project
// skill named like a bundled skill. Its Instruction check asks for a provider and model, then shows its run's latest message
// and thread, and the agent's Clashes once the run is done, or why it ended without them with Retry, which starts a new
// thread. The Pull request step lists what the PR changes, opens it, then waits for its merge.

import { useEffect, useState, type ReactNode } from 'react';
import { Check, FileText, FolderPlus, GitPullRequest, LoaderCircle, Lock, X } from 'lucide-react';
import {
  SETUP_CHECKS, customLabelChoices, customLabelProblem, isOnboarding, isSkillName, labelsToCreate, onboardingConfigFile, shownRepo, threadLink, type Clash, type ClashRun, type CheckedTool, type LabelPlan, type LabelRow,
  type LeftAloneLabel, type ModelChoice, type ModelGroup, type OnboardingPrChange, type ProjectChoice, type RepositoryItemSource, type SetupCheckId,
  type SkillClash,
} from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { RadioGroup, RadioGroupItem } from '@lar-factory/ui/design-system/RadioGroup';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { Progress } from '@lar-factory/ui/progress';
import { useBoardStore } from '../board/board-store.ts';
import { CopyButton } from '../copy/copy-button.tsx';
import { LinkButton } from '../items/link-button.tsx';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { toolDescription, toolState } from '../settings/settings-pages.tsx';
import { Choice, CustomLabelPicker, CustomLabelsTitle, Field, customLabelsHelp, Group, SHOW_TITLES, SetupFields, ShowChoices } from './setup-fields.tsx';
import {
  commandChecks, type Clashes, type Creating, type Labels, type Run, type StepId, asksSetup, commandPasses, configOf, customLabelsToCreate, itemSourceOf, labelsPlan, latestRun,
  nextModel, onboarded, pickedProject, picksOf, prClosed, renaming, skillProblem, skillsDir, ticked, typedLabelProblem, unpickable, useWizardStore,
} from './wizard-store.ts';

/** Whether the project's repository has .lar-factory.json. */
function ConfigBadge({ project }: { project: ProjectChoice }) {
  if (project.hasConfig) return <Badge tone="info">Saved settings</Badge>;
  if (project.hasConfig === false) return <Badge>New setup</Badge>;
  return !!project.provider && <Badge>Could not check settings</Badge>;
}

/** A problem with Retry, which reads T3's projects and their Repository configs again. */
function Problem({ title, children }: { title: string; children: ReactNode }) {
  const loadProjects = useWizardStore((s) => s.loadProjects);
  return (
    <Alert tone="danger" title={title} action={<Button {...kind('other')} onClick={() => void loadProjects()}>Retry</Button>}>{children}</Alert>
  );
}

/** What a step shows while T3's projects are read, or when they can't be; null once they are. */
function ProjectsPending() {
  const projects = useWizardStore((s) => s.projects);
  if (projects.state === 'loading') {
    return <p data-reading-projects className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Loading T3 Code projects...</p>;
  }
  if (projects.state === 'failed') return <Problem title="Could not load projects">{projects.error}</Problem>;
  return null;
}

/** Add a folder to T3 Code's folder, which Add runs `t3 project add` on; a failure shows t3's message and keeps the step. */
function NewProject({ creating }: { creating: Creating }) {
  const { setFolder, createProject } = useWizardStore();
  const add = () => void createProject();
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <Field label="Folder" hint="Enter the full path to the repository folder on this Mac.">
        {(described) => <span className="flex gap-2">
          <Input data-new-folder className="font-mono" placeholder="~/Developer/lar-web" value={creating.folder} disabled={creating.adding} {...described}
            onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Button {...kind('other')} data-add-project disabled={!creating.folder.trim()} loading={creating.adding}
            leftIcon={creating.adding ? undefined : <FolderPlus />} onClick={add}>{creating.adding ? 'Adding...' : 'Add to T3 Code'}</Button>
        </span>}
      </Field>
      {creating.error && <Alert tone="danger" title="Could not add the project">{creating.error}</Alert>}
    </div>
  );
}

function ProjectStep({ run }: { run: Run }) {
  const { projects, creating, pick, chooseNew } = useWizardStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  return (
    <Group legend="Repository folder" hint="Choose the repository folder where agents will work.">
      {projects.projects.length === 0 && <p className="m-0 text-sm text-base-700">Add a repository folder to T3 Code to begin.</p>}
      <RadioGroup value={run.projectId ?? (creating ? 'new' : '')} onValueChange={(id) => (id === 'new' ? chooseNew() : pick(id as string))} className="gap-2">
        {projects.projects.map((p) => {
          const reason = unpickable(p, run, { onboarding });
          const kept = p.onBoard && isOnboarding({ onboarding }, p.repo);
          return (
            <Choice key={p.id} value={p.id} disabled={!!reason} title={<span className="flex flex-wrap items-center gap-2">{p.name}
              {p.provider && <Badge>{p.provider}</Badge>}
              <ConfigBadge project={p} />
              {p.onBoard && <Badge>{kept ? 'onboarding' : 'on the board'}</Badge>}</span>}>
              <span className="font-mono">{p.folder}</span>{p.repo ? ` · ${shownRepo(p.repo)}` : ` · ${reason}`}{p.repo && kept && reason && ` · ${reason}`}
            </Choice>
          );
        })}
        <Choice value="new" title="Add a folder to T3 Code">Use a repository already on this Mac.</Choice>
      </RadioGroup>
      {creating && <NewProject creating={creating} />}
    </Group>
  );
}

/** An item source as a line naming the repository’s issues or the Azure team’s work. */
const sourceLine = (source: RepositoryItemSource, repo: string) => source.kind === 'azure-board' ? `${source.team}'s backlog and current sprint` : `${repo}'s issues`;

/** The provider, from the origin's host, which onboarding can't change. */
function ProviderRow({ project }: { project: ProjectChoice }) {
  return (
    <div data-field="provider" className="grid gap-1.5">
      <span className="text-sm font-medium">Hosting service</span>
      <Badge className="justify-self-start">{project.provider}</Badge>
      <span className="text-xs text-base-700">This service hosts {shownRepo(project.repo!)} and its work.</span>
    </div>
  );
}

/** The values of the .lar-factory.json onboarding reuses, which it doesn't ask again. */
function ReusedConfig({ project, config }: { project: ProjectChoice; config: NonNullable<ProjectChoice['config']> }) {
  return (
    <div className="grid gap-3">
      <Badge tone="info" className="justify-self-start">Saved in .lar-factory.json</Badge>
      <dl data-reused-config className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
        <dt className="text-base-700">Hosting service</dt><dd className="m-0">{project.provider}</dd>
        <dt className="text-base-700">Work to read</dt><dd className="m-0">{sourceLine(config.itemSource, project.repo!)}</dd>
        <dt className="text-base-700">Show</dt><dd className="m-0">{SHOW_TITLES[config.show]}</dd>
        <dt className="text-base-700">What this repository does</dt><dd className="m-0">{config.role}</dd>
      </dl>
      <p className="m-0 text-xs text-base-700">These saved settings will be reused. You can edit them in Settings after setup.</p>
    </div>
  );
}

function SetupStep({ run }: { run: Run }) {
  const { projects, answer, checks } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-base-700">This project is no longer in T3 Code. Go back and choose another.</p>;
  if (project.config) return <ReusedConfig project={project} config={project.config} />;
  return (
    <div className="grid gap-6">
      <ProviderRow project={project} />
      {project.configProblem ? (
        <Problem title="Could not use saved settings">{project.configProblem} Fix .lar-factory.json on {shownRepo(project.repo)}'s default branch, then retry.</Problem>
      ) : !asksSetup(project) ? (
        <Problem title="Could not check saved settings">Check access to {shownRepo(project.repo)}, then retry.</Problem>
      ) : run.setup && <SetupFields repo={project.repo} azure={project.provider === 'Azure DevOps'} setup={run.setup} onAnswer={answer} counts={checks?.setup.source.state === 'done' && checks.setup.source.result.passed ? checks.setup.source.result.counts : undefined} />}
    </div>
  );
}

/**
 * One label the step needs: its name and what it does, then whether the repository has it, or Rename for its old name.
 * On Azure DevOps a missing tag is one no work item carries yet.
 */
function LabelItem({ row, labels, azure }: { row: LabelRow; labels: Labels; azure: boolean }) {
  const toggleRename = useWizardStore((s) => s.toggleRename);
  return (
    <li data-label={row.label.name} data-state={row.state} className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: `#${row.label.color}` }} />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="font-mono font-medium break-all">{row.label.name}</span>
        <span className="text-xs text-base-700">{row.label.description}</span></span>
      {row.state === 'rename' ? (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={!labels.kept.includes(row.oldName)} disabled={!!labels.busy} onChange={() => toggleRename(row.oldName)} />
          Rename <code className="font-mono break-all">{row.oldName}</code>
        </label>
      ) : <Badge tone={row.state === 'present' ? 'success' : 'warning'}>{azure && row.state === 'missing' ? 'not used yet' : row.state}</Badge>}
    </li>
  );
}

function LabelList({ title, note, rows, labels, azure }: { title: string; note?: string; rows: LabelRow[]; labels: Labels; azure: boolean }) {
  return (
    <div className="grid gap-1">
      <h4 className="m-0 text-xs font-medium text-base-700">{title}</h4>
      {note && <p className="m-0 text-xs text-base-700">{note}</p>}
      <ul className="m-0 grid list-none divide-y rounded-lg border p-0">{rows.map((row) => <LabelItem key={row.label.name} row={row} labels={labels} azure={azure} />)}</ul>
    </div>
  );
}

/**
 * The labels the step changes nothing on, less the custom labels it lists; an old name beside its new label keeps its
 * issues, or work items on Azure DevOps, until the user moves them.
 */
function LeftAlone({ labels, azure }: { labels: LeftAloneLabel[]; azure: boolean }) {
  if (!labels.length) return null;
  return (
    <div data-left-alone className="grid gap-1">
      <h4 className="m-0 text-xs font-medium text-base-700">{azure ? 'Other tags' : 'Other labels'}</h4>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {labels.map((l) => (
          <li key={l.name} data-left={l.name} className="min-w-0 break-all"><code className="font-mono">{l.name}</code>
            {l.keptBeside && <span className="text-xs text-base-700"> The name {l.keptBeside} already exists. Move items to it before removing {l.name}.</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The custom labels: a reused .lar-factory.json's, listed; else the custom label picker, whose Add creates the typed
 * label on the repository and picks it. On Azure DevOps they are tags, which the step creates none of: Add only picks one.
 */
function CustomLabels({ run, project, plan, labels }: { run: Run; project: ProjectChoice; plan: LabelPlan; labels: Labels }) {
  const { toggleCustomLabel, typeCustomLabel, addCustomLabel } = useWizardStore();
  const azure = project.provider === 'Azure DevOps';
  if (project.config) {
    const { labels: names } = project.config;
    const missing = customLabelsToCreate(project, labels);
    return (
      <div data-custom-labels className="grid gap-1">
        <CustomLabelsTitle noun={azure ? 'tag' : 'label'} />
        <p className="m-0 text-xs text-base-700">{customLabelsHelp(azure ? 'tag' : 'label')} These come from the saved settings for {shownRepo(project.repo!)}. {azure
          ? 'Tags appear when first used.' : 'Create adds any missing labels.'}</p>
        {names.length ? (
          <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
            {names.map((name) => {
              const problem = typedLabelProblem(project, name);
              const state = problem ? 'problem' : missing.includes(name) ? 'missing' : 'present';
              return (
                <li key={name} data-custom={name} data-state={state} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <code className="break-all font-mono">{name}</code>
                    {problem && <span data-problem className="text-xs text-(--lar-danger-text)">{problem}</span>}
                  </span>
                  <Badge tone={state === 'present' ? 'success' : state === 'missing' ? 'warning' : 'danger'}>
                    {problem ? azure ? 'can\'t use' : 'can\'t create' : azure && state === 'missing' ? 'not used yet' : state}</Badge>
                </li>
              );
            })}
          </ul>
        ) : <p className="m-0 text-sm text-base-700">No custom {azure ? 'tags' : 'labels'} are saved.</p>}
      </div>
    );
  }
  return (
    <CustomLabelPicker repo={project.repo!} azure={azure} offered={customLabelChoices(plan)} picked={run.customLabels} typed={labels.typed} adding={labels.busy === 'custom'} busy={!!labels.busy}
      error={labels.error?.action === 'custom' ? labels.error : null} onToggle={toggleCustomLabel} onType={typeCustomLabel} onAdd={() => void addCustomLabel()} />
  );
}

const STATUS_LABELS_NOTE = 'These labels record where work is on the board. Create adds any missing labels.';
const STATUS_TAGS_NOTE = 'These tags record where work is on the board. They appear when first used.';

/**
 * The Labels step: each workflow label with what it does and whether the repository has it, the status labels for
 * a repository that reads its issues, Create and Rename, the custom labels, then the labels it leaves alone. On Azure
 * DevOps it shows the project's tags, with the status tags, and offers Rename but no Create.
 */
function LabelsStep({ run }: { run: Run }) {
  const { projects, labels, loadLabels, createLabels, renameLabels } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-base-700">This project is no longer in T3 Code. Go back and choose another.</p>;
  const azure = project.provider === 'Azure DevOps';
  const nouns = azure ? 'tags' : 'labels';
  if (!labels || labels.read.state === 'loading') {
    return <p className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Reading {shownRepo(project.repo)}'s {nouns}...</p>;
  }
  if (labels.read.state === 'failed') {
    return <Alert tone="danger" title={<>Could not load {nouns} for {shownRepo(project.repo)}</>} action={<Button {...kind('other')} onClick={() => void loadLabels()}>Retry</Button>}>{labels.read.error}</Alert>;
  }
  const plan = labelsPlan(run, project, labels)!;
  const creates = azure ? 0 : labelsToCreate(plan, renaming(plan, labels)).length + customLabelsToCreate(project, labels).length;
  // The custom labels the step lists as picked, a reused file's or the run's, which Other labels leaves out.
  const chosen = new Set((project.config?.labels ?? run.customLabels).map((l) => l.toLowerCase()));
  const renames = renaming(plan, labels).length;
  const retry = labels.error?.action === 'rename' ? renameLabels : createLabels;
  return (
    <div className="grid gap-4">
      <p className="m-0 text-xs text-base-700">{azure
        ? `Tags group work in Azure DevOps. New tags appear when first used. Renaming a tag keeps it on existing work.`
        : `Labels group issues in GitHub. Create the missing labels before continuing. Renaming a label keeps it on existing issues.`}</p>
      <p className="m-0 text-sm" role="status" aria-live="polite">{labels.busy === 'create' && labels.progress
        ? `Created ${labels.progress.created} of ${labels.progress.total}.`
        : azure ? 'Tags appear when you first use them. You can continue.' : creates || renames ? `${creates} missing labels. ${renames ? `${renames} to rename.` : ''}` : 'All required labels are ready.'}</p>
      {(creates > 0 || renames > 0 || labels.busy === 'create') && <div className="flex gap-2">
        {(creates > 0 || labels.busy === 'create') && <Button {...kind('other')} data-create-labels disabled={!!labels.busy} loading={labels.busy === 'create'} onClick={() => void createLabels()}>
          {labels.busy === 'create' ? 'Creating...' : `Create ${creates} missing`}</Button>}
        {renames > 0 && <Button {...kind('other')} data-rename-labels disabled={!!labels.busy} loading={labels.busy === 'rename'} onClick={() => void renameLabels()}>
          {labels.busy === 'rename' ? 'Renaming...' : `Rename ${renames}`}</Button>}
      </div>}
      {labels.error && labels.error.action !== 'custom' && (
        <Alert tone="danger" title={labels.error.action === 'create' ? `Can't create the ${nouns}` : `Can't rename the ${nouns}`} action={<Button {...kind('other')} disabled={!!labels.busy} onClick={() => void retry()}>Retry</Button>}>{labels.error.message}</Alert>
      )}
      <details className="grid gap-3" data-label-details>
        <summary className="cursor-pointer text-sm font-medium">View all {nouns}</summary>
        <div className="grid gap-4 pt-3">
          <LabelList title={`Work ${nouns}`} rows={plan.workflow} labels={labels} azure={azure} />
          {plan.status.length > 0 && <LabelList title={`Status ${nouns}`} note={azure ? STATUS_TAGS_NOTE : STATUS_LABELS_NOTE} rows={plan.status} labels={labels} azure={azure} />}
          <LeftAlone labels={plan.leftAlone.filter((l) => !labels.created.includes(l.name) && !chosen.has(l.name.toLowerCase()))} azure={azure} />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Choose custom {nouns} (optional)</summary>
        <div className="pt-3"><CustomLabels run={run} project={project} plan={plan} labels={labels} /></div>
      </details>
    </div>
  );
}

type CheckStatus = 'waiting' | 'running' | 'passed' | 'failed';

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'passed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/16 text-success"><Check className="size-3.5" /></span>;
    case 'failed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-danger/16 text-danger"><X className="size-3.5" /></span>;
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

const STATUS_TEXT: Record<CheckStatus, string> = { waiting: 'Waiting', running: 'Checking...', passed: 'Passed', failed: 'Failed' };

function CheckList({ title, rows }: { title: string; rows: CheckRow[] }) {
  return (
    <div className="grid gap-1">
      <h4 className="m-0 text-xs font-medium text-base-700">{title}</h4>
      <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
        {rows.map((row) => (
          <li key={row.id} data-check={row.id} data-status={row.status} className="grid gap-2 px-3 py-2">
            <div className="flex items-center gap-2.5 text-sm">
              <StatusIcon status={row.status} />
              <span className="font-medium">{row.title}</span>
              <span className="ml-auto text-xs text-base-700">{row.detail || STATUS_TEXT[row.status]}</span>
            </div>
            {row.status === 'failed' && (
              <Alert tone="danger" title={row.problem} action={row.retry && <Button {...kind('other')} onClick={row.retry}>Retry</Button>}><span>{row.fix}</span>
                  {row.command && <span className="flex items-center gap-2"><code className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-xs">{row.command}</code>
                    <CopyButton text={row.command} label={`Copy ${row.command}`} /></span>}
                </Alert>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const COMMAND_TITLES: Record<CheckedTool, string> = { gh: 'gh login', az: 'az login', t3: 't3 and T3 Code', git: 'git', jq: 'jq', curl: 'curl' };
/** Each setup check's title; the push check names the login, az's on Azure DevOps. */
const setupTitle = (id: SetupCheckId, provider: ProjectChoice['provider']) => id === 'checkout' ? 'Repository folder'
  : id === 'source' ? 'Read work' : `Permission to push changes`;

function ChecksStep({ run }: { run: Run }) {
  const { projects, checks, runChecks, retryCheck, answer } = useWizardStore();
  const tools = useBoardStore((s) => s.data.tools);
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-base-700">This project is no longer in T3 Code. Go back and choose another.</p>;
  if (!checks) return null;
  const source = itemSourceOf(run, project);
  const retryAll = () => void runChecks();
  const commands = commandChecks(source).map((name): CheckRow => {
    const check = tools?.[name];
    if (checks.commands.state === 'running') return { id: name, title: COMMAND_TITLES[name], status: 'running' };
    if (commandPasses(name, tools, source)) return { id: name, title: COMMAND_TITLES[name], status: 'passed', detail: toolState(check, name === 'gh' || name === 'az').text };
    return { id: name, title: COMMAND_TITLES[name], status: 'failed', problem: `${name}: ${toolState(check).text}`, fix: toolDescription('', check), retry: retryAll };
  });
  const setup = SETUP_CHECKS.map((id): CheckRow => {
    const check = checks.setup[id];
    const title = setupTitle(id, project.provider);
    if (check.state !== 'done') return { id, title, status: check.state, detail: id === 'source' && check.state === 'running' ? project.provider === 'Azure DevOps' ? 'Reading the team backlog and sprint. This can take a minute.' : 'Reading GitHub work. This can take a minute.' : undefined };
    const { result } = check;
    return result.passed ? { id, title, status: 'passed', detail: result.detail }
      : { id, title, status: 'failed', problem: result.problem, fix: result.fix, command: result.command, retry: () => void retryCheck(id) };
  });
  const rows = [...commands, ...setup];
  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const caption = `${passed} of ${rows.length} passed${failed ? ` · ${failed} need you` : ''}`;
  return (
    <div className="grid gap-4">
      <Progress value={passed} max={rows.length} caption={caption} aria-label={caption} />
      {checks.commands.state === 'failed' && (
        <Alert tone="danger" title="Can't check the commands" action={<Button {...kind('other')} onClick={retryAll}>Retry</Button>}>{checks.commands.error}</Alert>
      )}
      <CheckList title="Tools" rows={commands} />
      <CheckList title="Repository access" rows={setup} />
      {checks.setup.source.state === 'done' && checks.setup.source.result.passed && checks.setup.source.result.counts && !project.config && run.setup && (
        <ShowChoices setup={run.setup} azure={project.provider === 'Azure DevOps'} counts={checks.setup.source.result.counts} onAnswer={answer} />
      )}
    </div>
  );
}

/** A Clash's edit, as the PR would make it: the lines it swaps, or the delete or rename of its file or folder; dimmed when it won't apply. */
function EditPreview({ clash }: { clash: Clash }) {
  const { edit } = clash;
  return (
    <pre data-edit-preview className={`m-0 ml-7 overflow-x-auto rounded-md bg-base-200 px-2.5 py-1.5 font-mono text-xs ${clash.wontApply ? 'opacity-60' : ''}`}>
      {edit.kind === 'lines' ? (<>
        {edit.remove.map((line, i) => <div key={`-${i}`} className="text-(--lar-danger-text)">- {line}</div>)}
        {edit.add.map((line, i) => <div key={`+${i}`} className="text-(--lar-success-text)">+ {line}</div>)}
      </>) : edit.kind === 'delete' ? <div className="text-(--lar-danger-text)">Delete {clash.file}</div>
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
        <Checkbox checked={ticked(clash, picks)} disabled={!!clash.wontApply} onChange={(e) => tick(clash.id, e.target.checked)} className="mt-0.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-mono text-xs">{clash.file}{clash.line !== undefined && `:${clash.line}`}</span>
          <span className="text-xs text-base-700">{clash.reason}</span>
          {clash.wontApply && <span data-wont-apply className="text-xs text-(--lar-warning-text)">Cannot apply this change. {clash.wontApply}</span>}
        </span>
      </label>
      <EditPreview clash={clash} />
    </li>
  );
}

/** A project skill named like a bundled skill: Remove it in the pull request, or Rename it, with what Next waits for. */
function SkillClashPick({ skill, picks, clashes }: { skill: SkillClash; picks: Run['cleanup']; clashes: Extract<Clashes, { state: 'read' }> }) {
  const pickSkill = useWizardStore((s) => s.pickSkill);
  const pick = picks?.skills[skill.path];
  const problem = skillProblem(skill, picks, clashes);
  const name = pick?.kind === 'rename' ? pick.name : '';
  // A name restored on Resume counts as typed, so its problem shows as an error straight away.
  const [typed, setTyped] = useState(name !== '');
  return (
    <Alert data-skill-clash={skill.path} tone={problem ? 'warning' : 'info'} title={<>Rename or remove the local <span className="font-mono">{skill.name}</span> skill</>}>
        <span><span className="font-mono">{skill.path}</span> would replace the bundled <span className="font-mono">{skill.name}</span>. Choose how to fix it before continuing.</span>
        <RadioGroup value={pick?.kind ?? ''} onValueChange={(kind) => pickSkill(skill.path, kind === 'delete' ? { kind } : { kind: 'rename', name })} className="mt-1 gap-2">
          <div data-skill-pick="delete"><RadioGroupItem value="delete" label="Remove it in the pull request" /></div>
          <div data-skill-pick="rename"><RadioGroupItem value="rename" label="Rename it" /></div>
        </RadioGroup>
        {pick?.kind === 'rename' && (
          <div className="mt-1 w-full text-base-content">
            <Field name="skill-name" label="New skill name" problem={problem ?? undefined} invalid={typed}
              hint={<>The pull request moves the skill to <span className="font-mono">{skillsDir(skill.path)}{isSkillName(name) ? name : 'new-name'}/</span> and updates its name.</>}>
              {(described) => <Input className="font-mono" value={name} {...described} onBlur={() => setTyped(true)}
                onChange={(e) => { setTyped(true); pickSkill(skill.path, { kind: 'rename', name: e.target.value }); }} />}
            </Field>
          </div>
        )}
        {problem && pick?.kind !== 'rename' && <span data-problem className="text-xs">{problem}</span>}
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
  const reason = !run.threadId ? 'The thread is not available yet.' : !environment ? 'T3 Code has not shared its link details yet.' : null;
  // Pointer events stay on while it's disabled, so its title says why.
  return reason
    ? <Button {...kind('open')} className="disabled:pointer-events-auto" data-thread-link disabled title={reason} leftIcon={ICON.thread}>Open thread</Button>
    : <LinkButton kind="open" data-thread-link href={threadLink(environment!, run.threadId!)} leftIcon={ICON.thread}>Open thread</LinkButton>;
}

/** Why a run ended without Clashes, by its state. */
const ENDED: Record<'failed' | 'timed-out' | 'waiting', string> = {
  failed: 'The agent could not finish',
  'timed-out': 'The agent took too long',
  waiting: 'The agent needs an answer',
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
    return <p data-reading-models className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Loading available models...</p>;
  }
  if (!groups.length) return <p className="m-0 text-sm text-base-700">Enable an AI provider and model in T3 Code settings to continue.</p>;
  const group = groups.find((g) => g.instanceId === model?.instanceId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="agent-provider" label="Provider" hint="Choose the AI service that will check your instructions.">
        {(described) => <NativeSelect value={model?.instanceId ?? ''} disabled={disabled} {...described} onChange={(e) => {
          const picked = groups.find((g) => g.instanceId === e.target.value);
          if (picked?.models[0]) pickModel({ instanceId: picked.instanceId, model: picked.models[0].slug });
        }}>
          {!group && <option value={model?.instanceId ?? ''} disabled>{model ? model.instanceId : 'Pick a provider'}</option>}
          {groups.map((g) => <option key={g.instanceId} value={g.instanceId}>{g.name}</option>)}
        </NativeSelect>}
      </Field>
      <Field name="agent-model" label="Model" hint="Choose the AI model for this check.">
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
 * The Instruction check: the provider and model, then Check instructions; the latest run's latest message while it runs, its
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
      <h4 className="m-0 text-xs font-medium text-base-700">Instruction check</h4>
      <p className="m-0 text-xs text-base-700">An agent checks for instructions that could send work the wrong way. Wait for it to finish before continuing. You can close this window and resume later.</p>
      <ModelPicker model={model} disabled={running} />
      {/* After a failed start the alert's Retry starts the run, so Look again doesn't offer a second way. */}
      {(!latest || latest.state === 'done') && agent.error?.call !== 'start' && (
        <Button {...kind('other')} data-look-for-clashes className="justify-self-start" disabled={!model || running}
          loading={agent.starting} onClick={look}>
          {agent.starting ? 'Starting...' : latest ? 'Look again' : 'Check instructions'}</Button>
      )}
      {agent.error && (
        <Alert tone="danger" title="Could not reach the agent" action={<Button {...kind('other')} disabled={running} onClick={() => agent.error?.call === 'start' ? look() : void readClashRuns()}>Retry</Button>}>{agent.error.message}</Alert>
      )}
      {latest?.state === 'running' ? (
        <div data-agent-run="running" className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LoaderCircle className="size-4 animate-spin text-info" /> Agent running on {modelName(groups, latest.model)}
            <span className="ml-auto"><ThreadLink run={latest} /></span>
          </div>
          <p data-agent-progress className="m-0 whitespace-pre-wrap text-xs text-base-700">{latest.progress ?? 'Waiting for the agent to respond.'}</p>
        </div>
      ) : latest?.state === 'done' ? (
        <div data-agent-run="done" className="grid gap-1">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-success" /> {modelName(groups, latest.model)} found {latest.clashes.length === 1 ? '1 issue' : `${latest.clashes.length} issues`}
            <span className="ml-auto"><ThreadLink run={latest} /></span>
          </div>
          {latest.clashes.length
            ? <ul className="m-0 list-none divide-y rounded-lg border p-0">{latest.clashes.map((clash) => <ClashRow key={clash.id} clash={clash} picks={run.cleanup} />)}</ul>
            : <p className="m-0 text-sm text-base-700">The agent found no problems.</p>}
        </div>
      ) : latest && (
        <Alert data-agent-run={latest.state} tone={latest.state === 'failed' ? 'danger' : 'warning'} title={ENDED[latest.state]} action={<><ThreadLink run={latest} />
            <Button {...kind('other')} disabled={!model || running} loading={agent.starting} onClick={look}>Retry</Button></>}>{latest.why}</Alert>
      )}
      {earlier.length > 0 && (
        <ul data-earlier-runs className="m-0 grid list-none gap-1 p-0 text-xs text-base-700">
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
      <span className="min-w-0 text-xs text-base-700">{what}</span>
    </span>
  );
}

/** What the PR writes whatever is ticked; a reused .lar-factory.json stays as it is. On Azure DevOps, items are work items and labels are tags. */
function AlwaysWritten({ reused, azure }: { reused: boolean; azure: boolean }) {
  const rows = [
    { file: '## Agent skills', what: 'Adds or replaces the agent instructions in CLAUDE.md or AGENTS.md.' },
    { file: 'docs/agents/issue-tracker.md', what: `Tells agents where to track ${azure ? 'work items' : 'issues'}.` },
    { file: 'docs/agents/triage-labels.md', what: `Explains how agents use ${azure ? 'tags' : 'labels'}.` },
    { file: 'docs/agents/domain.md', what: 'Points agents to the glossary and decision records.' },
    { file: '.lar-factory.json', what: reused ? 'Keeps your saved settings.' : 'Saves this repository\'s board settings.' },
  ];
  return (
    <div data-always-written className="grid gap-1">
      <h4 className="m-0 text-xs font-medium text-base-700">Files to update</h4>
      <ul className="m-0 grid list-none gap-1 rounded-lg border bg-base-200/40 p-3 text-sm">
        {rows.map((row) => (
          <li key={row.file} data-written={row.file} className="flex items-start gap-2"><Lock className="mt-0.5 size-3 shrink-0 text-base-700" />
            <PathAndWhat path={row.file} what={row.what} /></li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The fixed checks' Clashes, each with its edit to tick, and Delete or Rename for each project skill named like a
 * bundled skill, which Next waits for; then the Instruction check and what the PR always writes. A failed run shows the board's problem with Retry.
 */
function CleanupStep({ run }: { run: Run }) {
  const { projects, clashes, findClashes } = useWizardStore();
  if (projects.state !== 'loaded') return <ProjectsPending />;
  const project = pickedProject(run, projects);
  if (!project?.repo) return <p className="m-0 text-sm text-base-700">This project is no longer in T3 Code. Go back and choose another.</p>;
  return (
    <div data-cleanup-step className="grid gap-6">
      <p className="m-0 text-sm text-base-700">Review changes to {shownRepo(project.repo)}'s instructions. Only checked fixes go into the pull request.</p>
      {(!clashes || clashes.state === 'reading') ? (
        <p data-reading-clashes className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Checking known problems...</p>
      ) : clashes.state === 'failed' ? (
        <Alert tone="danger" title="Could not check instructions" action={<Button {...kind('other')} onClick={() => void findClashes()}>Retry</Button>}>{clashes.error}</Alert>
      ) : (<>
        {clashes.found.skillClashes.map((skill) => <SkillClashPick key={skill.path} skill={skill} picks={run.cleanup} clashes={clashes} />)}
        <div className="grid gap-1">
          <h4 className="m-0 text-xs font-medium text-base-700">Known problems</h4>
          {clashes.found.clashes.length
            ? <ul className="m-0 list-none divide-y rounded-lg border p-0">{clashes.found.clashes.map((clash) => <ClashRow key={clash.id} clash={clash} picks={run.cleanup} />)}</ul>
            : <p className="m-0 text-sm text-base-700">No known problems found.</p>}
        </div>
      </>)}
      <ClashAgent run={run} />
      <AlwaysWritten reused={!!project.config} azure={project.provider === 'Azure DevOps'} />
    </div>
  );
}

/** The PR's place from its URL: `owner/name#n` on GitHub, `organization/project/repository!n` on Azure Repos. */
export function prName(url: string): string {
  const azure = /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/.exec(url);
  if (!azure) return url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#');
  const [, organization, project, repository, id] = azure;
  return `${shownRepo(`${organization}/${project}/${repository}`)}!${id}`;
}

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
    return <p data-reading-changes className="m-0 flex items-center gap-2 text-sm text-base-700"><LoaderCircle className="size-4 animate-spin" /> Loading changes...</p>;
  }
  if (changes.state === 'failed') {
    return <Alert tone="danger" title="Could not load changes" action={<Button {...kind('other')} onClick={() => void readPrChanges()}>Retry</Button>}>{changes.error}</Alert>;
  }
  return (
    <ul data-pr-changes className="m-0 grid list-none gap-1 rounded-lg border p-3 text-sm">
      {changes.changes.map((change, i) => {
        const row = changeRow(change);
        return (
          <li key={i} data-change={row.path} className="flex items-start gap-2"><FileText className="mt-0.5 size-3.5 shrink-0 text-base-700" />
            <div className="min-w-0 flex-1">
              <PathAndWhat path={row.path} what={row.what} />
              {change.preview && <details className="mt-2">
                <summary className="cursor-pointer text-xs text-base-700">View contents</summary>
                <div className="mt-2 grid gap-2">
                  {change.preview.before === null ? <p className="m-0 text-xs text-base-700">New file</p> : <>
                    <p className="m-0 text-xs font-medium">Current contents</p>
                    <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-base-200 p-3 font-mono text-xs">{change.preview.before}</pre>
                  </>}
                  <p className="m-0 text-xs font-medium">Proposed contents</p>
                  <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-base-200 p-3 font-mono text-xs">{change.preview.after}</pre>
                </div>
              </details>}
            </div></li>
        );
      })}
    </ul>
  );
}

/**
 * The PR: what it changes, Open pull request with the Cleanup step's picks, then the wait for its merge, which the board
 * finishes. A PR closed before merging offers Reopen pull request and Start over.
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
  if (!project?.repo || !config) return <p className="m-0 text-sm text-base-700">This project is no longer in T3 Code. Go back and choose another.</p>;
  const repo = shownRepo(project.repo);
  // Open pull request waits for its changes to be listed, so the PR holds only what the step shows.
  const openable = !pr.opening && !!picksOf(run, clashes, agent) && changes?.state === 'read';
  if (run.prUrl && onboarded(run, data)) {
    return (
      <div data-pr-step>
        <Alert tone="success" title={`${repo} is ready`}>The pull request merged. You can now start work on {repo} from the board.</Alert>
      </div>
    );
  }
  return (
    <div data-pr-step className="grid gap-4">
      <div className="grid gap-1">
        <h4 className="m-0 text-xs font-medium text-base-700">Changes for {repo}</h4>
        <p className="m-0 text-xs text-base-700">Review these changes, then open a pull request to save them. Your local files stay as they are.</p>
        {listed && (<>
          <PrChangeList />
          {!project.config && <pre className="m-0 overflow-x-auto rounded-lg border bg-base-200/40 p-3 font-mono text-xs">{onboardingConfigFile(config)}</pre>}
        </>)}
      </div>
      {run.prUrl && prClosed(run, data) ? (
        <Alert tone="warning" data-pr-closed title={<>{prName(run.prUrl)} closed before merging</>} action={<><Button {...kind('other')} disabled={pr.opening} loading={pr.reopening}
              onClick={() => void reopenPr()}>Reopen pull request</Button>
            <Button {...kind('other')} disabled={pr.reopening || !openable} onClick={() => void startOver()}>Start over</Button></>}>
            <span>Reopen this pull request or start a new one.</span>
            {pr.error && <span className="block text-(--lar-danger-text)">{pr.error}</span>}
          </Alert>
      ) : run.prUrl ? (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2.5 text-sm">
            <LoaderCircle className="size-4 animate-spin text-info" />
            <span><a className="font-medium underline" href={run.prUrl} target="_blank" rel="noreferrer">{prName(run.prUrl)}</a> is ready for you to review and merge.</span>
            <Button {...kind('other')} className="ml-auto" loading={pr.checking}
              onClick={() => void checkMerge()}>{pr.checking ? 'Checking...' : 'Check now'}</Button>
          </div>
          {pr.checkedAt !== null && !pr.checking && !pr.error && (
            <p data-checked className="m-0 text-xs text-base-700" role="status">Last checked at {new Date(pr.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. The pull request is still open.</p>
          )}
          {pr.error && (
            <Alert tone="danger" title="Could not check the pull request" action={<Button {...kind('other')} disabled={pr.checking} onClick={() => void checkMerge()}>Retry</Button>}>{pr.error}</Alert>
          )}
          <p className="m-0 text-xs text-base-700">Merge the pull request to finish setup. You can close this window and resume later.</p>
        </div>
      ) : pr.error ? (
        <Alert tone="danger" title="Could not open the pull request" action={<Button {...kind('other')} disabled={!openable} onClick={() => void openPr()}>Retry</Button>}>{pr.error}</Alert>
      ) : (
        <Button {...kind('main')} className="justify-self-start" disabled={!openable} loading={pr.opening} leftIcon={pr.opening ? undefined : <GitPullRequest />}
          onClick={() => void openPr()}>{pr.opening ? 'Opening pull request...' : 'Open pull request'}</Button>
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
