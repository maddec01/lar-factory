// Add item's Create issue checkbox follows the repository's default until this item changes it, and shows the optional provider fields.
import { useEffect, useState, type ReactNode } from 'react';
import { effectiveIssueSettings, trackerCapabilities, writeAccessProblem, type RepoConfig, type TicketCreationOptions, type TicketOptions } from '@lar-factory/shared';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { FormSelect } from '@lar-factory/ui/form-select';
import { useEditStore } from '../repositories/edit-store.ts';
import type { DraftValues } from './add-item-store.ts';
import { DraftLabels } from './draft-labels.tsx';

const HINT = 'm-0 text-xs leading-snug text-(--muted-foreground)';
const SMALL_HEADING = 'm-0 text-[11px] font-medium uppercase tracking-wider text-(--muted-foreground)';

/** A side panel section under a small uppercase heading, which labels the field `htmlFor` names. */
export function PanelSection({ heading, htmlFor, children }: { heading: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className={SMALL_HEADING}>{heading}</label>
      {children}
    </div>
  );
}

/** An optional ticket field, for a form to read; a value no longer among its choices starts at None. */
function OptionField({ name, label, choices, value: start = '' }: { name: string; label: string; choices: { value: string; name: string }[]; value?: string }) {
  const [value, setValue] = useState(() => choices.some(choice => choice.value === start) ? start : '');
  return choices.length > 0 && (
    <PanelSection heading={label} htmlFor={`item-${name}`}>
      <FormSelect id={`item-${name}`} name={name} none="None" value={value} onChange={setValue} choices={choices} />
    </PanelSection>
  );
}

export function TicketOptionFields({ repo, kind, kept }: { repo: RepoConfig; kind: string; kept?: TicketOptions }) {
  const [read, setRead] = useState<TicketCreationOptions | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void fetch(`/api/ticket-options?repo=${encodeURIComponent(repo.repo)}`).then(async response => {
      const result = await response.json() as { options?: TicketCreationOptions; error?: string };
      if (!response.ok || !result.options) throw Error(result.error ?? 'Could not read issue options.');
      if (current) setRead(result.options);
    }).catch(() => { if (current) setError('Could not read issue options. You can still submit the title and description.'); });
    return () => { current = false; };
  }, [repo.repo]);
  if (error) return <p role="status" className={HINT}>{error}</p>;
  if (!read) return <p role="status" className={HINT}>Reading issue options… You can submit while they load.</p>;
  const setup = repo.setup;
  const access = setup?.access ?? {};
  const safety = { azureReadOnly: setup?.azureReadOnly };
  const mapping = setup?.vocabulary[kind as 'bug' | 'feature' | 'improvement'];
  const type = kept?.type ?? mapping?.type ?? '';
  const names = (values: string[]) => values.map(value => ({ value, name: value }));
  const labelsShown = !writeAccessProblem(repo.repo, 'tag-ticket', access, safety)
    && (read.labels.length > 0 || !writeAccessProblem(repo.repo, 'manage-labels', access, safety));
  return <div className="grid gap-3">
    {read.problems.length > 0 && <p role="status" className={HINT}>Some issue options could not be read. You can still submit the title and description.</p>}
    {labelsShown && <DraftLabels repo={repo} kind={kind} read={read} kept={kept} headingClass={SMALL_HEADING} />}
    {!writeAccessProblem(repo.repo, 'type-ticket', access, safety) && <OptionField key={kind} name="type" label={read.provider === 'azure' ? 'Work item type' : 'Issue type'} choices={names(read.types)} value={type} />}
    <OptionField name="assignee" label="Assignee" choices={names(read.assignees)} value={kept?.assignee} />
    {read.provider === 'github' && <OptionField name="milestone" label="Milestone" choices={read.milestones} value={kept?.milestone} />}
    {read.provider === 'azure' && <OptionField name="iteration" label="Iteration" choices={names(read.iterations)} value={kept?.iteration} />}
  </div>;
}

/** Whether Add item creates a ticket in `repo` under this item's `choice`, null until changed, and why it can't. */
function createIssueState(repo: RepoConfig, choice: boolean | null): { checked: boolean; reason: string | null } {
  const effective = repo.setup ? effectiveIssueSettings(repo.setup) : null;
  const reason = effective?.createReason ?? (effective ? null : 'Issue access is not checked yet. Recheck access in Settings.');
  return { checked: !reason && (choice ?? effective?.createIssuesFromAddItem ?? false), reason };
}

/** The Create issue checkbox, with the reason when it's disabled. */
export function CreateIssueBox({ repo, choice, onChoice, disabled }: { repo: RepoConfig; choice: boolean | null; onChoice: (checked: boolean) => void; disabled: boolean }) {
  const running = useEditStore(state => state.running);
  const error = useEditStore(state => state.errors[repo.repo]);
  const { checked, reason } = createIssueState(repo, choice);
  return <div className="grid gap-1">
    <Checkbox id="item-create-issue" name="createIssue" label="Create issue" checked={checked} disabled={disabled || !!reason}
      aria-describedby={reason ? 'item-create-reason' : undefined} onChange={event => onChoice(event.target.checked)} />
    {reason && <p id="item-create-reason" className={`${HINT} max-w-md`}>{reason} <button type="button" disabled={disabled || running !== null}
      className="underline underline-offset-2 hover:text-(--foreground) disabled:opacity-50" onClick={() => void useEditStore.getState().recheck(repo.repo)}>Recheck access</button></p>}
    {error && <p role="status" className={HINT}>{error}</p>}
  </div>;
}

/** The side panel's part of Create issue: the ticket fields when it's on, or what local work has when it's off. */
export function IssueFields({ repo, kind, kept, choice }: { repo: RepoConfig; kind: string; kept?: DraftValues | null; choice: boolean | null }) {
  const { checked, reason } = createIssueState(repo, choice);
  return <div className="grid gap-3 border-t border-base-300 pt-4">
    {checked
      ? <TicketOptionFields repo={repo} kind={kind} kept={kept?.kind === kind ? kept.options : undefined} />
      : <p className={HINT}>Local work has its kind alone.{reason ? '' : ` Tick Create issue to add ${trackerCapabilities(repo.repo).heading.toLowerCase()}.`} Saved only on this machine.</p>}
  </div>;
}

/** Both forms submit exactly the optional fields currently visible. */
export function ticketOptions(form: HTMLFormElement): TicketOptions {
  const values = new FormData(form);
  return {
    ...(form.querySelector('#item-labels') ? { labels: values.getAll('labels').map(String) } : {}),
    ...(values.has('newLabels') ? { newLabels: values.getAll('newLabels').map(String) } : {}),
    ...Object.fromEntries(['type', 'assignee', 'milestone', 'iteration'].filter(name => values.has(name)).map(name => [name, String(values.get(name) ?? '')])),
  };
}
