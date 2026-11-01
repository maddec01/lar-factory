// Add item uses the repository default once, then keeps this item's choice and optional provider fields.
import { useEffect, useState } from 'react';
import { effectiveIssueSettings, writeAccessProblem, type RepoConfig, type TicketCreationOptions, type TicketOptions } from '@lar-factory/shared';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { FormSelect } from '@lar-factory/ui/form-select';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind as buttonKind } from '../buttons/button-kinds.tsx';
import { useEditStore } from '../repositories/edit-store.ts';
import type { DraftValues } from './add-item-store.ts';

const HINT = 'm-0 text-xs leading-snug text-(--muted-foreground)';

/** An optional ticket field, for a form to read; a value no longer among its choices starts at None. */
function OptionField({ name, label, choices, value: start = '' }: { name: string; label: string; choices: { value: string; name: string }[]; value?: string }) {
  const [value, setValue] = useState(() => choices.some(choice => choice.value === start) ? start : '');
  return choices.length > 0 && (
    <label className="grid gap-1.5 text-xs" htmlFor={`item-${name}`}>{label}
      <FormSelect id={`item-${name}`} name={name} none="None" value={value} onChange={setValue} choices={choices} />
    </label>
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
  const labels = kept?.labels ?? mapping?.labels ?? [];
  const type = kept?.type ?? mapping?.type ?? '';
  const names = (values: string[]) => values.map(value => ({ value, name: value }));
  return <div className="grid gap-3" key={kind}>
    {read.problems.length > 0 && <p role="status" className={HINT}>Some issue options could not be read. You can still submit the title and description.</p>}
    {!writeAccessProblem(repo.repo, 'tag-ticket', access, safety) && read.labels.length > 0 && <div role="group" aria-label={read.provider === 'azure' ? 'Tags' : 'Labels'} id="item-labels" className="grid gap-1.5">
      <span className="text-xs">{read.provider === 'azure' ? 'Tags' : 'Labels'}</span>
      {read.labels.map(label => <Checkbox key={label} name="labels" value={label} label={label} defaultChecked={labels.includes(label)} />)}
    </div>}
    {!writeAccessProblem(repo.repo, 'type-ticket', access, safety) && <OptionField name="type" label={read.provider === 'azure' ? 'Work item type' : 'Issue type'} choices={names(read.types)} value={type} />}
    <OptionField name="assignee" label="Assignee" choices={names(read.assignees)} value={kept?.assignee} />
    {read.provider === 'github' && <OptionField name="milestone" label="Milestone" choices={read.milestones} value={kept?.milestone} />}
    {read.provider === 'azure' && <OptionField name="iteration" label="Iteration" choices={names(read.iterations)} value={kept?.iteration} />}
  </div>;
}

export function IssueFields({ repo, kind, kept }: { repo: RepoConfig; kind: string; kept?: DraftValues | null }) {
  const running = useEditStore(state => state.running);
  const error = useEditStore(state => state.errors[repo.repo]);
  const effective = repo.setup ? effectiveIssueSettings(repo.setup) : null;
  const reason = effective?.createReason ?? (effective ? null : 'Issue access is not checked yet. Recheck access in Settings.');
  const [checked, setChecked] = useState(kept?.createIssue ?? effective?.createIssuesFromAddItem ?? false);
  const enabled = !reason && checked;
  return <div className="grid gap-3">
    <Checkbox id="item-create-issue" name="createIssue" label="Create issue" checked={enabled} disabled={!!reason}
      aria-describedby={reason ? 'item-create-reason' : undefined} onChange={event => setChecked(event.target.checked)} />
    {reason && <div className="grid gap-2">
      <p id="item-create-reason" className={HINT}>{reason}</p>
      <Button {...buttonKind('other')} type="button" disabled={running !== null} onClick={() => void useEditStore.getState().recheck(repo.repo)}>Recheck access</Button>
      {error && <p role="status" className={HINT}>{error}</p>}
    </div>}
    {enabled && <TicketOptionFields repo={repo} kind={kind} kept={kept?.kind === kind ? kept.options : undefined} />}
  </div>;
}

/** Both forms submit exactly the optional fields currently visible. */
export function ticketOptions(form: HTMLFormElement): TicketOptions {
  const values = new FormData(form);
  return {
    ...(form.querySelector('[name="labels"]') ? { labels: values.getAll('labels').map(String) } : {}),
    ...Object.fromEntries(['type', 'assignee', 'milestone', 'iteration'].filter(name => values.has(name)).map(name => [name, String(values.get(name) ?? '')])),
  };
}
