// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. Only the T3 project step is filled in; the later steps' slices fill in theirs.

import type { ReactNode } from 'react';
import { CircleAlert, FolderPlus, LoaderCircle, RotateCw } from 'lucide-react';
import type { ProjectChoice } from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { type Creating, type Run, type StepId, unpickable, useWizardStore } from './wizard-store.ts';

/** One choice of a radio group: its title, then a line of detail. */
function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <label data-project={value} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-data-checked:border-ring has-data-checked:bg-accent/40 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <Radio value={value} disabled={disabled} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-sm font-medium">{title}</span>{children && <span className="text-xs text-muted-foreground">{children}</span>}</span>
    </label>
  );
}

/** One field on its own row: its label, the control, then one line of help. */
function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="grid gap-1.5"><span className="text-sm font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</label>;
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
  const { projects, creating, pick, chooseNew, loadProjects } = useWizardStore();
  if (projects.state === 'loading') return <p className="m-0 text-sm text-muted-foreground">Reading T3 Code’s projects…</p>;
  if (projects.state === 'failed') return (
    <Alert variant="error"><CircleAlert /><AlertTitle>Can’t list T3 Code’s projects</AlertTitle>
      <AlertDescription>{projects.error}</AlertDescription>
      <AlertAction><Button size="xs" variant="outline" onClick={() => void loadProjects()}><RotateCw /> Retry</Button></AlertAction>
    </Alert>
  );
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

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  if (step === 'project') return <ProjectStep run={run} />;
  return <p className="m-0 text-sm text-muted-foreground">This step comes in a later part of build #382.</p>;
}
