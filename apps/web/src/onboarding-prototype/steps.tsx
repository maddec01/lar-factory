// PROTOTYPE (#363), throwaway: the body of each onboarding step, which the wizard dialog shows one at a time.

import type { ReactNode } from 'react';
import { Check, CircleAlert, ExternalLink, FileText, GitPullRequest, LoaderCircle, Lock, RotateCw, X } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Checkbox } from '@lar-factory/ui/checkbox';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { Progress } from '@lar-factory/ui/progress';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { CopyButton } from '../copy/copy-button.tsx';
import {
  AGENT_LOG, AGENT_MODELS, ALWAYS_WRITTEN, AZURE_TEAMS, CHECKS, type Clash, FOREIGN_LABELS, GITHUB_PROJECTS, LABELS, SKILL_CLASH, T3_PROJECTS,
  providerOf, repoOf,
} from './mock.ts';
import { type CheckStatus, type Run, type Show, type StepId, projectOf, providerOfRun, sourceOfRun, useWizardStore } from './wizard-store.ts';

const patch = (change: Partial<Run>) => useWizardStore.getState().patch(change);

function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-data-checked:border-ring has-data-checked:bg-accent/40 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <Radio value={value} disabled={disabled} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-sm font-medium">{title}</span>{children && <span className="text-xs text-muted-foreground">{children}</span>}</span>
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="grid gap-1.5"><span className="text-sm font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>;
}

function ProjectStep({ run }: { run: Run }) {
  const onBoard = useWizardStore((s) => s.repos);
  return (
    <div className="grid gap-4">
      <p className="m-0 text-sm text-muted-foreground">Onboarding connects a repository to the board. Its threads run in its T3 project, whose folder is the repository’s main checkout.</p>
      <RadioGroup value={run.projectChoice === 'new' ? 'new' : run.projectName ?? ''} onValueChange={(v) => patch(v === 'new' ? { projectChoice: 'new' } : { projectChoice: 'existing', projectName: v as string })} className="gap-2">
        {T3_PROJECTS.map((p) => {
          const taken = onBoard.some((r) => r.repo === repoOf(p.origin) && r.run?.id !== run.id);
          return (
            <Choice key={p.name} value={p.name} disabled={taken} title={<span className="flex flex-wrap items-center gap-2">{p.name}
              <Badge variant="outline" size="sm">{providerOf(p.origin)}</Badge>
              {p.config && <Badge variant="info" size="sm">has .lar-factory.json</Badge>}
              {taken && <Badge variant="secondary" size="sm">on the board</Badge>}</span>}>
              <span className="font-mono">{p.path}</span> · {repoOf(p.origin)}
            </Choice>
          );
        })}
        <Choice value="new" title="Create a new T3 project">From a folder on this Mac; onboarding clones the origin there if the folder is empty.</Choice>
      </RadioGroup>
      {run.projectChoice === 'new' && (
        <div className="grid gap-3 rounded-lg border p-3">
          <Field label="Folder"><Input font="mono" value={run.newPath} onChange={(e) => patch({ newPath: e.target.value })} /></Field>
          <Field label="Git origin" hint="The provider comes from its host: github.com or dev.azure.com.">
            <Input font="mono" placeholder="git@github.com:owner/repo.git" value={run.newOrigin} onChange={(e) => patch({ newOrigin: e.target.value })} />
          </Field>
        </div>
      )}
      {projectOf(run)?.config && (
        <Alert variant="info"><FileText /><AlertTitle>Reusing the Repository config</AlertTitle>
          <AlertDescription>{repoOf(projectOf(run)!.origin)} already has <code>.lar-factory.json</code> on its default branch. Onboarding takes its answers, skips those questions, and only checks dependencies, labels and the T3 project.</AlertDescription></Alert>
      )}
    </div>
  );
}

const SUGGESTED: Record<Run['source'], Show> = { project: 'All items', issues: 'Opted-in items', sprint: 'All items', backlog: 'Opted-in items' };

function SetupStep({ run }: { run: Run }) {
  const project = projectOf(run);
  if (!project) return null;
  const provider = providerOf(project.origin);
  const config = project.config;
  if (config) {
    return (
      <div className="grid gap-3">
        <Badge variant="info" className="justify-self-start">From .lar-factory.json on main</Badge>
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-lg border p-3 text-sm">
          <dt className="text-muted-foreground">Provider</dt><dd className="m-0">{provider}</dd>
          <dt className="text-muted-foreground">Item source</dt><dd className="m-0">{config.itemSource}</dd>
          <dt className="text-muted-foreground">Show</dt><dd className="m-0">{config.show}</dd>
          <dt className="text-muted-foreground">List group</dt><dd className="m-0">{config.platform}</dd>
          <dt className="text-muted-foreground">Repository role</dt><dd className="m-0">{config.role}</dd>
          <dt className="text-muted-foreground">Labels</dt><dd className="m-0">{config.labels.join(', ')}</dd>
        </dl>
        <p className="m-0 text-xs text-muted-foreground">To change these, edit the Repository config after onboarding; that opens a PR on the file.</p>
      </div>
    );
  }
  const setSource = (source: Run['source']) => patch({ source, ...(!run.showTouched && { show: SUGGESTED[source] }) });
  const azure = provider === 'Azure DevOps';
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Provider</span><Badge variant="outline">{provider}</Badge>
        <span className="text-xs text-muted-foreground">from origin’s host, <span className="font-mono">{project.origin.replace(/^.*@|^https:\/\//, '').split(/[:/]/)[0]}</span></span></div>
      <Fieldset unstyled className="grid gap-2">
        <FieldsetLegend>Item source</FieldsetLegend>
        <p className="m-0 -mt-1 text-xs text-muted-foreground">Where the board finds this repository’s items. It lists the items that can show.</p>
        <RadioGroup value={run.source} onValueChange={(v) => setSource(v as Run['source'])} className="gap-2">
          {azure ? (<>
            <Choice value="sprint" title="The team’s current sprint">Contoso / Fabrikam</Choice>
            <Choice value="backlog" title="The team’s backlog">Open User Stories, PBIs or Issues under the team’s area paths, in any sprint.</Choice>
          </>) : (<>
            <Choice value="project" title="A GitHub Project">A user-owned Project, named by owner and number.</Choice>
            <Choice value="issues" title="The repository’s issues">{repoOf(project.origin)}’s own issues, with no extra fields.</Choice>
          </>)}
        </RadioGroup>
        {run.source === 'project' && <NativeSelect value={run.githubProject} onChange={(e) => patch({ githubProject: e.target.value })}>{GITHUB_PROJECTS.map((p) => <option key={p}>{p}</option>)}</NativeSelect>}
        {azure && <NativeSelect value={run.team} onChange={(e) => patch({ team: e.target.value })}>{AZURE_TEAMS.map((t) => <option key={t}>{t}</option>)}</NativeSelect>}
      </Fieldset>
      <Fieldset unstyled className="grid gap-2">
        <FieldsetLegend>Show</FieldsetLegend>
        <RadioGroup value={run.show} onValueChange={(v) => patch({ show: v as Show, showTouched: true })} className="gap-2">
          {(['All items', 'Opted-in items'] as const).map((s) => (
            <Choice key={s} value={s} title={<span className="flex items-center gap-2">{s}{SUGGESTED[run.source] === s && <Badge variant="secondary" size="sm">Suggested</Badge>}</span>}>
              {s === 'All items' ? 'Every open item from the item source; an item with no status counts as List.' : `Opt-in: only items that carry a status show; someone opts an item in by giving it ${run.source === 'project' ? 'the List Status' : azure ? 'the status-list tag' : 'the status-list label'}.`}
            </Choice>
          ))}
        </RadioGroup>
      </Fieldset>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="List group" hint="Names this repository’s group in the List and in the Scope picker."><Input placeholder="Web" value={run.platform} onChange={(e) => patch({ platform: e.target.value, platformTouched: true })} /></Field>
        <Field label="Repository role" hint="What this repository is to the others."><Input placeholder="Web client that talks to the API server" value={run.role} onChange={(e) => patch({ role: e.target.value })} /></Field>
      </div>
      <Fieldset unstyled className="grid gap-2">
        <FieldsetLegend>{azure ? 'Tags' : 'Labels'} onboarding creates</FieldsetLegend>
        {LABELS.map((l) => (
          <label key={l.name} className="flex items-center gap-2 text-sm">
            <Checkbox checked={run.labels.includes(l.name)} onCheckedChange={(on) => patch({ labels: on ? [...run.labels, l.name] : run.labels.filter((x) => x !== l.name) })} />
            <span className="font-mono">{l.name}</span><span className="text-xs text-muted-foreground">{l.note}</span>
          </label>
        ))}
        {run.source !== 'project' && <p className="m-0 text-xs text-muted-foreground">Plus one <span className="font-mono">status-</span>{azure ? 'tag' : 'label'} per status, which the board swaps as items move.</p>}
        <p className="m-0 text-xs text-muted-foreground">Left alone, since onboarding didn’t create them: {FOREIGN_LABELS.map((l) => <span key={l} className="font-mono">{l} </span>)}</p>
      </Fieldset>
    </div>
  );
}

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'passed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/16 text-success"><Check className="size-3.5" /></span>;
    case 'failed': return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-destructive/16 text-destructive"><X className="size-3.5" /></span>;
    case 'running': return <LoaderCircle className="size-5 shrink-0 animate-spin text-info" />;
    default: return <span className="size-5 shrink-0 rounded-full border border-dashed" />;
  }
}

function ChecksStep({ run }: { run: Run }) {
  const retry = useWizardStore((s) => s.retry);
  const passed = run.checks.filter((c) => c.status === 'passed').length;
  const failed = run.checks.filter((c) => c.status === 'failed').length;
  return (
    <div className="grid gap-4">
      <Progress value={passed} max={run.checks.length || 1} caption={`${passed} of ${run.checks.length} passed${failed ? ` · ${failed} need you` : ''}`} />
      {(['Commands', 'Setup'] as const).map((group) => (
        <div key={group} className="grid gap-1">
          <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group === 'Commands' ? 'Required commands' : 'Setup'}</h4>
          <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
            {run.checks.map((c) => ({ c, spec: CHECKS.find((s) => s.id === c.id)! })).filter(({ spec }) => spec.group === group).map(({ c, spec }) => (
              <li key={c.id} className="grid gap-2 px-3 py-2">
                <div className="flex items-center gap-2.5 text-sm">
                  <StatusIcon status={c.status} />
                  <span className="font-medium">{spec.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{c.status === 'passed' ? spec.passed : c.status === 'running' ? 'Checking…' : c.status === 'failed' ? 'Failed' : 'Waiting'}</span>
                </div>
                {c.status === 'failed' && spec.failure && (
                  <Alert variant="error"><CircleAlert /><AlertTitle>{spec.failure.text}</AlertTitle>
                    <AlertDescription><span>Run this in a terminal, then retry:</span>
                      <span className="flex items-center gap-2"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{spec.failure.command}</code><CopyButton text={spec.failure.command} label={`Copy ${spec.failure.command}`} /></span>
                    </AlertDescription>
                    <AlertAction><Button size="xs" variant="outline" onClick={() => retry(c.id)}><RotateCw /> Retry</Button></AlertAction>
                  </Alert>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ClashRow({ clash, onTick }: { clash: Clash; onTick: (on: boolean) => void }) {
  return (
    <li className="grid gap-2 px-3 py-2.5">
      <label className="flex cursor-pointer items-start gap-2.5">
        <Checkbox checked={clash.ticked} onCheckedChange={onTick} className="mt-0.5" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{clash.title}<span className="font-mono text-xs font-normal text-muted-foreground">{clash.file}</span></span>
          <span className="text-xs text-muted-foreground">{clash.reason}</span>
        </span>
      </label>
      <pre className="m-0 ml-7 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
        {clash.edit.remove && <div className="text-destructive">- {clash.edit.remove}</div>}
        {clash.edit.add && <div className="text-success">+ {clash.edit.add}</div>}
      </pre>
    </li>
  );
}

function CleanupStep({ run }: { run: Run }) {
  const runAgent = useWizardStore((s) => s.runAgent);
  const { agent } = run;
  const tick = (id: string, on: boolean) => patch({ clashes: run.clashes.map((c) => (c.id === id ? { ...c, ticked: on } : c)) });
  return (
    <div className="grid gap-5">
      <p className="m-0 text-sm text-muted-foreground">Onboarding runs fixed checks for known Clashes, then an agent in a T3 thread in this repository’s project reads every instruction file and reports rules that work against the factory’s. Only the edits you tick go into the PR.</p>
      <Fieldset unstyled disabled={agent.state !== 'idle'} className="grid gap-2">
        <FieldsetLegend>Clash agent</FieldsetLegend>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Provider"><NativeSelect value={agent.provider} onChange={(e) => patch({ agent: { ...agent, provider: e.target.value, model: AGENT_MODELS[e.target.value]![0]! } })}>{Object.keys(AGENT_MODELS).map((p) => <option key={p}>{p}</option>)}</NativeSelect></Field>
          <Field label="Model"><NativeSelect value={agent.model} onChange={(e) => patch({ agent: { ...agent, model: e.target.value } })}>{AGENT_MODELS[agent.provider]!.map((m) => <option key={m}>{m}</option>)}</NativeSelect></Field>
          {agent.state === 'idle' && <Button onClick={runAgent}>Look for Clashes</Button>}
        </div>
      </Fieldset>
      {agent.state !== 'idle' && (
        <div className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon status={agent.state === 'done' ? 'passed' : 'running'} />
            {agent.state === 'done' ? `Done · ${agent.provider} ${agent.model} found ${run.clashes.filter((c) => c.kind === 'agent').length} Clashes` : `Agent running on ${agent.provider} ${agent.model}`}
            <Button size="xs" variant="ghost" className="ml-auto"><ExternalLink /> Open thread</Button>
          </div>
          <Progress value={agent.log} max={AGENT_LOG.length} />
          <ul className="m-0 grid list-none gap-0.5 p-0 font-mono text-xs text-muted-foreground">
            {AGENT_LOG.slice(0, agent.state === 'done' ? AGENT_LOG.length : agent.log + 1).map((l, i) => <li key={l}>{i < agent.log ? '✓' : '…'} {l}</li>)}
          </ul>
        </div>
      )}
      {agent.state === 'done' && (<>
        <Alert variant={run.skillChoice ? 'default' : 'warning'}><CircleAlert />
          <AlertTitle>Project skill <span className="font-mono">{SKILL_CLASH.bundled}</span> is named like a bundled skill</AlertTitle>
          <AlertDescription>
            <span><span className="font-mono">{SKILL_CLASH.path}</span> would shadow the factory’s <span className="font-mono">{SKILL_CLASH.bundled}</span>. Onboarding can’t continue until you pick one:</span>
            <RadioGroup value={run.skillChoice ?? ''} onValueChange={(v) => patch({ skillChoice: v as Run['skillChoice'] })} className="mt-1 gap-1.5">
              <label className="flex items-center gap-2 text-sm text-foreground"><Radio value="delete" /> Delete it in the PR</label>
              <label className="flex items-center gap-2 text-sm text-foreground"><Radio value="rename" /> Rename it to
                <Input size="sm" font="mono" className="w-48" value={run.skillName} disabled={run.skillChoice !== 'rename'} onChange={(e) => patch({ skillName: e.target.value })} /></label>
            </RadioGroup>
          </AlertDescription>
        </Alert>
        <div className="grid gap-1">
          <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixed checks</h4>
          <ul className="m-0 list-none divide-y rounded-lg border p-0">{run.clashes.filter((c) => c.kind === 'fixed').map((c) => <ClashRow key={c.id} clash={c} onTick={(on) => tick(c.id, on)} />)}</ul>
        </div>
        <div className="grid gap-1">
          <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent’s Clashes</h4>
          <ul className="m-0 list-none divide-y rounded-lg border p-0">{run.clashes.filter((c) => c.kind === 'agent').map((c) => <ClashRow key={c.id} clash={c} onTick={(on) => tick(c.id, on)} />)}</ul>
        </div>
        <AlwaysWritten run={run} />
      </>)}
    </div>
  );
}

function AlwaysWritten({ run }: { run: Run }) {
  const reused = !!projectOf(run)?.config;
  return (
    <div className="grid gap-1">
      <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Always written</h4>
      <ul className="m-0 grid list-none gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
        {ALWAYS_WRITTEN.map((w) => (
          <li key={w.file} className="flex items-baseline gap-2"><Lock className="size-3 shrink-0 self-center text-muted-foreground" /><span className="font-mono text-xs">{w.file}</span>
            <span className="text-xs text-muted-foreground">{w.file === '.lar-factory.json' && reused ? 'kept as it is on main' : w.what}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** The PR's changes: everything always written plus each ticked edit. */
function prChanges(run: Run): string[] {
  const reused = !!projectOf(run)?.config;
  return [
    ...ALWAYS_WRITTEN.filter((w) => !(reused && w.file === '.lar-factory.json')).map((w) => `${w.file}`),
    ...run.clashes.filter((c) => c.ticked).map((c) => `${c.title} (${c.file})`),
    run.skillChoice === 'delete' ? `Delete ${SKILL_CLASH.path}` : `Rename ${SKILL_CLASH.path} to .claude/skills/${run.skillName}/`,
  ];
}

function PrStep({ run }: { run: Run }) {
  const { openPr, merge } = useWizardStore();
  const project = projectOf(run)!;
  const repo = repoOf(project.origin);
  if (run.pr === 'merged') {
    return (
      <Alert variant="success"><Check /><AlertTitle>{repo} is onboarded</AlertTitle>
        <AlertDescription>PR #14 merged. The board reads {repo}’s items from its item source on the next refresh, and Start build works for it now.</AlertDescription></Alert>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">One PR on {repo}, branch lar-factory/onboarding</h4>
        <ul className="m-0 grid list-none gap-1 rounded-lg border p-3 text-sm">{prChanges(run).map((c) => <li key={c} className="flex items-center gap-2"><Check className="size-3.5 text-success" />{c}</li>)}</ul>
      </div>
      {run.pr === 'none' ? (
        <Button className="justify-self-start" onClick={openPr}><GitPullRequest /> Open the PR</Button>
      ) : (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2.5 text-sm">
            <LoaderCircle className="size-4 animate-spin text-info" />
            <span><a className="font-medium underline" href="#pr">PR #14 chore: onboard to lar Factory</a> is open. Waiting for its merge.</span>
          </div>
          <p className="m-0 text-xs text-muted-foreground">You can close the wizard: {repo} stays on the board as onboarding, with Resume, and Start build stays disabled until the merge. A merge made while the wizard is closed finishes onboarding the next time the board checks.</p>
          <Button size="xs" variant="outline" className="justify-self-start border-dashed" onClick={merge}>Prototype: simulate the merge</Button>
        </div>
      )}
    </div>
  );
}

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  switch (step) {
    case 'project': return <ProjectStep run={run} />;
    case 'setup': return <SetupStep run={run} />;
    case 'checks': return <ChecksStep run={run} />;
    case 'cleanup': return <CleanupStep run={run} />;
    case 'pr': return <PrStep run={run} />;
  }
}

/** One line on a step, for the onboarding cards on the board. */
export function stepSummary(run: Run, step: StepId): string {
  const project = projectOf(run);
  switch (step) {
    case 'project': return project ? `${project.name} · ${project.path}` : 'Pick a project';
    case 'setup': return project?.config ? 'From .lar-factory.json' : `${providerOfRun(run)} · ${sourceOfRun(run)} · ${run.show}`;
    case 'checks': { const failed = run.checks.filter((c) => c.status === 'failed').length; return run.checks.length ? (failed ? `${failed} failed` : `${run.checks.filter((c) => c.status === 'passed').length} of ${run.checks.length} passed`) : 'Not run'; }
    case 'cleanup': return run.agent.state === 'done' ? `${run.clashes.filter((c) => c.ticked).length} edits ticked` : run.agent.state === 'running' ? 'Agent running' : 'Not run';
    case 'pr': return run.pr === 'merged' ? 'Merged' : run.pr === 'open' ? 'PR #14 waiting for merge' : 'Not opened';
  }
}
