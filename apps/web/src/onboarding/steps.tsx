// The body of each onboarding step, which the dialog shows one at a time. Each field sits on its own row with its
// label and one line of help. Only the T3 project step is filled in; the later steps' slices fill in theirs.

import type { ReactNode } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import type { ProjectChoice } from '@lar-factory/shared';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { type Run, type StepId, unpickable, useWizardStore } from './wizard-store.ts';

/** One choice of a radio group: its title, then a line of detail. */
function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <label data-project={value} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 has-data-checked:border-ring has-data-checked:bg-accent/40 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <Radio value={value} disabled={disabled} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5"><span className="text-sm font-medium">{title}</span>{children && <span className="text-xs text-muted-foreground">{children}</span>}</span>
    </label>
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

function ProjectStep({ run }: { run: Run }) {
  const { projects, pick, loadProjects } = useWizardStore();
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
      <RadioGroup value={run.projectId ?? ''} onValueChange={(id) => pick(id as string)} className="gap-2">
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
      </RadioGroup>
    </Group>
  );
}

export function StepBody({ run, step }: { run: Run; step: StepId }) {
  if (step === 'project') return <ProjectStep run={run} />;
  return <p className="m-0 text-sm text-muted-foreground">This step comes in a later part of build #382.</p>;
}
