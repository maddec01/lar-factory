// The setup fields and the custom label picker, which onboarding's steps and Edit both show. They hold no store: each
// takes its values and calls back with the user's changes. Choice, Field and Group lay out every question onboarding
// asks, one to a row with its label and one line of help.

import { useId, useState, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { customLabelProblem, type SetupAnswers, type ShowSetting } from '@lar-factory/shared';
import { Alert, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Badge } from '@lar-factory/ui/badge';
import { Button } from '@lar-factory/ui/button';
import { Checkbox } from '@lar-factory/ui/checkbox';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { Input } from '@lar-factory/ui/input';
import { Radio, RadioGroup } from '@lar-factory/ui/radio-group';
import { byTeam, setupProblems, suggestedShow, type SetupAction, type SetupChange } from './setup-answers.ts';

/** One choice of a radio group: its title, then a line of detail. */
export function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
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
export function Field({ name, label, hint, problem, invalid = false, children }: {
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
export function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Fieldset unstyled className="grid gap-2">
      <FieldsetLegend className="mb-0 font-medium">{legend}</FieldsetLegend>
      {hint && <p className="m-0 -mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </Fieldset>
  );
}

export const SHOW_TITLES: Record<ShowSetting, string> = { all: 'All items', 'opted-in': 'Opted-in items' };

type TextAnswer = keyof ReturnType<typeof setupProblems>;

/** An Azure DevOps repository's project, as people read it: organization/project/repository's middle part, decoded. */
export function azureProject(repo: string): string {
  const project = repo.split('/')[1] ?? '';
  try { return decodeURIComponent(project); } catch { return project; }
}

/**
 * The setup fields for `repo`: item source, with a Team field for an Azure DevOps one when `azure`, show setting with
 * the suggested one marked, and Repository role. A text answer's problem names `action`, the button that waits for it,
 * and is muted help until its field is edited or left. `disabled` locks the choices, which a disabled fieldset doesn't reach.
 */
export function SetupFields({ repo, azure = false, setup, action = 'Next', disabled, onAnswer }: {
  repo: string; azure?: boolean; setup: SetupAnswers; action?: SetupAction; disabled?: boolean; onAnswer: (change: SetupChange) => void;
}) {
  const suggested = suggestedShow(setup.itemSource);
  const problems = setupProblems(setup, action);
  const [touched, setTouched] = useState<ReadonlySet<TextAnswer>>(new Set());
  const touch = (key: TextAnswer) => { if (!touched.has(key)) setTouched(new Set([...touched, key])); };
  /** A text answer's problem, whether it's marked, and the handlers that mark it. */
  const textAnswer = (key: TextAnswer) => ({
    field: { problem: problems[key], invalid: touched.has(key) },
    control: { value: setup[key] ?? '', onBlur: () => touch(key), onChange: (e: { target: { value: string } }) => { touch(key); onAnswer({ [key]: e.target.value }); } },
  });
  const owner = textAnswer('projectOwner');
  const number = textAnswer('projectNumber');
  const team = textAnswer('team');
  const role = textAnswer('role');
  return (<>
    <Group legend="Item source" hint="Where the board finds this repository’s items. It lists the items that can show.">
      <RadioGroup value={setup.itemSource} onValueChange={(v) => onAnswer({ itemSource: v as SetupAnswers['itemSource'] })} className="gap-2">
        {azure ? (<>
          <Choice value="azure-sprint" title="The team’s current sprint" disabled={disabled}>The requirement-level work items in the team’s current iteration, with their Tasks.</Choice>
          <Choice value="azure-backlog" title="The team’s backlog" disabled={disabled}>The open requirement-level work items under the team’s area paths, in any sprint.</Choice>
        </>) : (<>
          <Choice value="github-project" title="A GitHub Project" disabled={disabled}>A Project named by its owner and number, which other repositories may name too.</Choice>
          <Choice value="issues" title="The repository’s issues" disabled={disabled}>{repo}’s own issues, with no extra fields.</Choice>
        </>)}
      </RadioGroup>
    </Group>
    {byTeam(setup.itemSource) && (
      <Field name="team" label="Team" hint={`The Azure DevOps team in ${azureProject(repo)} whose ${setup.itemSource === 'azure-sprint' ? 'sprint' : 'backlog'} the board reads.`} {...team.field}>
        {(described) => <Input placeholder={`e.g. ${azureProject(repo)} Team`} {...team.control} {...described} />}
      </Field>
    )}
    {setup.itemSource === 'github-project' && (<>
      <Field name="project-owner" label="Project owner" hint="The GitHub user or organization that owns the Project." {...owner.field}>
        {(described) => <Input font="mono" {...owner.control} {...described} />}
      </Field>
      <Field name="project-number" label="Project number" hint="The number in the Project’s URL, after /projects/." {...number.field}>
        {(described) => <Input font="mono" inputMode="numeric" placeholder="3" {...number.control} {...described} />}
      </Field>
    </>)}
    <Group legend="Show" hint="Which of the item source’s items show on the board.">
      <RadioGroup value={setup.show} onValueChange={(v) => onAnswer({ show: v as ShowSetting })} className="gap-2">
        {(['all', 'opted-in'] as const).map((show) => (
          <Choice key={show} value={show} disabled={disabled} title={<span className="flex items-center gap-2">{SHOW_TITLES[show]}{suggested === show && <Badge variant="secondary" size="sm">Suggested</Badge>}</span>}>
            {show === 'all' ? 'Every open item from the item source; an item with no status counts as List.'
              : `Only items that carry a status show; someone opts an item in by giving it ${setup.itemSource === 'github-project' ? 'the List Status' : azure ? 'the status-list tag' : 'the status-list label'}.`}
          </Choice>
        ))}
      </RadioGroup>
    </Group>
    <Field name="role" label="Repository role" hint="What this repository is to the others." {...role.field}>
      {(described) => <Input placeholder="Web client that talks to the API server" {...role.control} {...described} />}
    </Field>
  </>);
}

/** The custom label picker's values: the labels it offers, those picked, the new label's field, and an add that runs or failed. */
export interface CustomLabelPicks {
  offered: readonly string[];
  picked: readonly string[];
  typed: string;
  /** Whether Add is running, which locks the field. */
  adding: boolean;
  /** Whether another change on the repository's labels is running, which holds Add. */
  busy: boolean;
  /** An Add that failed: the label it was adding and gh's message. */
  error: { name?: string; message: string } | null;
  /** Whether the picks are locked, which a disabled fieldset doesn't reach. */
  disabled?: boolean;
}

/** What the picker calls back with: a toggled label, the new label's field as typed, and Add. */
export interface CustomLabelHandlers {
  onToggle: (name: string) => void;
  onType: (typed: string) => void;
  onAdd: () => void;
}

export const CUSTOM_LABELS_HELP = 'Custom labels mark which part of the product an item touches, such as app: music. Add item offers them, and the queue shows them on each item.';

export function CustomLabelsTitle() {
  return <h4 className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Custom labels</h4>;
}

/**
 * The custom label picker for `repo`: a toggle for each label it offers and each pick, then a field whose Add takes a
 * new label, which shows why it can't be one as it's typed.
 */
export function CustomLabelPicker({ repo, offered, picked, typed, adding, busy, error, disabled: locked, onToggle, onType, onAdd }: { repo: string } & CustomLabelPicks & CustomLabelHandlers) {
  const choices = [...offered, ...picked.filter((name) => !offered.some((o) => o.toLowerCase() === name.toLowerCase()))];
  const problem = typed.trim() ? customLabelProblem(typed) : null;
  const disabled = !typed.trim() || !!problem || adding || busy;
  const add = () => { if (!disabled) onAdd(); };
  return (
    <div data-custom-labels className="grid gap-2">
      <div className="grid gap-1"><CustomLabelsTitle /><p className="m-0 text-xs text-muted-foreground">{CUSTOM_LABELS_HELP} Pick the ones {repo} uses, or add a new one.</p></div>
      {choices.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
          {choices.map((name) => (
            <li key={name} data-custom={name}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(name)} disabled={locked} onCheckedChange={() => onToggle(name)} />
                <code className="min-w-0 break-all font-mono">{name}</code>
              </label>
            </li>
          ))}
        </ul>
      )}
      <span className="flex gap-2">
        <Input data-new-custom font="mono" placeholder="app: music" aria-label="New custom label" value={typed} disabled={adding}
          onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <Button data-add-custom variant="outline" disabled={disabled} onClick={add}>
          {adding ? <><LoaderCircle className="animate-spin" /> Adding…</> : 'Add'}</Button>
      </span>
      {problem && <p className="m-0 text-xs text-destructive-foreground">{problem}</p>}
      {error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t create {error.name}</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
    </div>
  );
}
