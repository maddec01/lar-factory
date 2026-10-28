// The setup fields and the custom label picker, which onboarding's steps and Edit both show. They hold no store: each
// takes its values and calls back with the user's changes. Choice, Field and Group lay out every question onboarding
// asks, one to a row with its label and one line of help.

import { useId, useState, type ReactNode } from 'react';
import { customLabelProblem, customTagProblem, shownRepo, type SetupAnswers, type ShowSetting } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Field as LabelledField } from '@lar-factory/ui/design-system/Field';
import { Input } from '@lar-factory/ui/design-system/Input';
import { RadioGroup, RadioGroupItem } from '@lar-factory/ui/design-system/RadioGroup';
import { Fieldset, FieldsetLegend } from '@lar-factory/ui/fieldset';
import { setupProblems, suggestedShow, type SetupAction, type SetupChange } from './setup-answers.ts';
import { kind } from '../buttons/button-kinds.tsx';

/** One choice of a radio group: its title, then a line of detail. */
export function Choice({ value, title, children, disabled }: { value: string; title: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <div data-choice={value} className={`rounded-lg border border-base-300 px-3 py-2.5 has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/8 ${disabled ? 'opacity-60' : ''}`}>
      <RadioGroupItem value={value} disabled={disabled} label={title} description={children} />
    </div>
  );
}

/** The props that tie a field's control to its help and problem. */
type Described = { 'aria-describedby'?: string };

/**
 * One field on its own row: the copied Field's label and control, one line of help, then what Next waits for from it,
 * if anything. The help and problem sit outside the label and describe the control, so they aren't read as its name.
 * The problem is muted help until `invalid`, which marks it and the control.
 */
export function Field({ name, label, hint, problem, invalid = false, children }: {
  name?: string; label: string; hint?: ReactNode; problem?: string; invalid?: boolean; children: (described: Described) => ReactNode;
}) {
  const id = useId();
  const marked = !!problem && invalid;
  const describedBy = [hint && `${id}-hint`, problem && `${id}-problem`].filter(Boolean).join(' ');
  return (
    <div data-field={name} className="grid gap-1.5">
      {/* The copied Field shows one helper line; the board shows the help and the problem below it instead. */}
      <LabelledField label={label} invalid={marked}>{children(describedBy ? { 'aria-describedby': describedBy } : {})}</LabelledField>
      {hint && <span id={`${id}-hint`} className="text-xs text-base-700">{hint}</span>}
      {problem && <span id={`${id}-problem`} data-problem className={`text-xs ${marked ? 'text-(--lar-danger-text)' : 'text-base-700'}`}>{problem}</span>}
    </div>
  );
}

/** A group of choices on its own row: its legend, one line of help, then the choices. */
export function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Fieldset unstyled className="grid gap-2">
      <FieldsetLegend>{legend}</FieldsetLegend>
      {hint && <p className="m-0 -mt-1 text-xs text-base-700">{hint}</p>}
      {children}
    </Fieldset>
  );
}

export const SHOW_TITLES: Record<ShowSetting, string> = { all: 'All items', 'opted-in': 'Items with a status' };

type TextAnswer = keyof ReturnType<typeof setupProblems>;

/** An Azure DevOps repository's project, as people read it: organization/project/repository's middle part, decoded. */
const azureProject = (repo: string): string => shownRepo(repo).split('/')[1] ?? '';

/**
 * The setup fields for `repo`: its saved source, an editable Team for an Azure board, and the show setting with
 * the suggested one marked, and Repository role. A text answer's problem names `action`, the button that waits for it,
 * and is muted help until its field is edited or left. `disabled` locks the choices, which a disabled fieldset doesn't reach.
 */
export function SetupFields({ repo, azure = false, setup, action = 'Next', disabled, onAnswer }: {
  repo: string; azure?: boolean; setup: SetupAnswers; action?: SetupAction; disabled?: boolean; onAnswer: (change: SetupChange) => void;
}) {
  const suggested = suggestedShow();
  const problems = setupProblems(setup, action);
  const [touched, setTouched] = useState<ReadonlySet<TextAnswer>>(new Set());
  const touch = (key: TextAnswer) => { if (!touched.has(key)) setTouched(new Set([...touched, key])); };
  /** A text answer's problem, whether it's marked, and the handlers that mark it. */
  const textAnswer = (key: TextAnswer) => ({
    field: { problem: problems[key], invalid: touched.has(key) },
    control: { value: setup[key] ?? '', onBlur: () => touch(key), onChange: (e: { target: { value: string } }) => { touch(key); onAnswer({ [key]: e.target.value }); } },
  });
  const team = textAnswer('team');
  const role = textAnswer('role');
  return (<>
    <div data-item-source className="grid gap-1.5">
      <span className="text-sm font-medium">Work to read</span>
      <p className="m-0 text-xs text-base-700">{azure ? "The team's backlog and current sprint. Each item appears once." : "This repository's GitHub issues."}</p>
    </div>
    {setup.itemSource === 'azure-board' && (
      <Field name="team" label="Team" hint={`The team that owns this work in ${azureProject(repo)}.`} {...team.field}>
        {(described) => <Input placeholder={`${azureProject(repo)} Team`} {...team.control} {...described} />}
      </Field>
    )}
    <Group legend="Show" hint="Choose which work appears on the board.">
      <RadioGroup value={setup.show} onValueChange={(v) => onAnswer({ show: v as ShowSetting })} className="gap-2">
        {(['all', 'opted-in'] as const).map((show) => (
          <Choice key={show} value={show} disabled={disabled} title={<span className="flex items-center gap-2">{SHOW_TITLES[show]}{suggested === show && <Badge tone="accent">Suggested</Badge>}</span>}>
            {show === 'all' ? 'Show all available work. Items without a status appear in List.'
              : `Show work with a board status. To include an item, give it ${azure ? 'the status-list tag in Azure DevOps' : 'the status-list label in GitHub'}.`}
          </Choice>
        ))}
      </RadioGroup>
    </Group>
    <Field name="role" label="What this repository does" hint="Describe its purpose so agents know where to work." {...role.field}>
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

/** What custom labels, or on Azure DevOps custom tags, are for. */
export const customLabelsHelp = (noun: 'label' | 'tag') =>
  `Use ${noun}s to group work, such as app: music.`;

export function CustomLabelsTitle({ noun = 'label' }: { noun?: 'label' | 'tag' }) {
  return <h4 className="m-0 text-xs font-medium text-base-700">Custom {noun}s</h4>;
}

/**
 * The custom label picker for `repo`: a toggle for each label it offers and each pick, then a field whose Add takes a
 * new label, which shows why it can't be one as it's typed. When `azure` they are tags, which can't hold a comma or
 * semicolon either, and the board writes a new one the first time a work item needs it.
 */
export function CustomLabelPicker({ repo, azure = false, offered, picked, typed, adding, busy, error, disabled: locked, onToggle, onType, onAdd }: { repo: string; azure?: boolean } & CustomLabelPicks & CustomLabelHandlers) {
  const noun = azure ? 'tag' : 'label';
  const choices = [...offered, ...picked.filter((name) => !offered.some((o) => o.toLowerCase() === name.toLowerCase()))];
  const problem = typed.trim() ? (azure ? customTagProblem : customLabelProblem)(typed) : null;
  const disabled = !typed.trim() || !!problem || adding || busy;
  const add = () => { if (!disabled) onAdd(); };
  return (
    <div data-custom-labels className="grid gap-2">
      <div className="grid gap-1"><CustomLabelsTitle noun={noun} /><p className="m-0 text-xs text-base-700">{customLabelsHelp(noun)} Choose the ones to offer when adding work to {shownRepo(repo)}.{azure
        && ' New tags appear when you first use them.'}</p></div>
      {choices.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
          {choices.map((name) => (
            <li key={name} data-custom={name}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(name)} disabled={locked} onChange={() => onToggle(name)} />
                <code className="min-w-0 break-all font-mono">{name}</code>
              </label>
            </li>
          ))}
        </ul>
      )}
      <span className="flex gap-2">
        <Input data-new-custom className="font-mono" placeholder="app: music" aria-label={`New ${noun}`} value={typed} disabled={adding}
          onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <Button {...kind('other')} data-add-custom disabled={disabled} loading={adding} onClick={add}>{adding ? 'Adding...' : 'Add'}</Button>
      </span>
      {problem && <p className="m-0 text-xs text-(--lar-danger-text)">{problem}</p>}
      {error && <Alert tone="danger" title={`Could not add ${error.name}`}>{error.message}</Alert>}
    </div>
  );
}
