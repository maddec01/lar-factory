import { useEffect, useRef, useState } from 'react';
import { kindMappingOffers, newLabelProblem, trackerCapabilities, typedLabelsProblem, writeAccessProblem, type RepositorySetup, type VocabularyTerm } from '@lar-factory/shared';
import { emptyVocabularyTerm, suggestVocabularyLabels, type VocabularyCapability, type VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { FIELD_GROUP, HelpTip } from '../settings/field-row.tsx';
import { AccessReason } from './access-list.tsx';
import { Input } from '@lar-factory/ui/design-system/Input';
import { FormSelect } from '@lar-factory/ui/form-select';
import { kind } from '../buttons/button-kinds.tsx';
import { postAction } from '../items/card-actions.ts';
import { useEditStore } from './edit-store.ts';

export const KIND_NAMES = { bug: 'Bug', feature: 'Feature', improvement: 'Improvement' } as const;
export type VocabularyKind = keyof typeof KIND_NAMES;
type VocabularyAccess = Pick<RepositorySetup, 'repo' | 'access' | 'azureReadOnly'>;

/** Discovery stays read-only; suggestions never become a mapping until the user chooses them. A label change reads it again. */
export function useVocabularyDiscovery(repo: string, onboarding = false) {
  const labelChanges = useEditStore((s) => s.labelChanges);
  const [read, setRead] = useState<{ repo: string; discovery: VocabularyDiscovery } | null>(null);
  const discovery = read?.repo === repo ? read.discovery : null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let current = true;
    setError(null);
    void postAction<{ discovery: VocabularyDiscovery }>(onboarding ? '/api/onboarding/vocabulary' : '/api/repositories/settings',
      onboarding ? { repo } : { repo, change: 'discover-vocabulary' }).then((result) => {
      if (!current) return;
      if (result.error || !result.discovery) setError(result.error ?? 'The board sent no vocabulary.');
      else setRead({ repo, discovery: result.discovery });
    });
    return () => { current = false; };
  }, [repo, onboarding, attempt, labelChanges]);
  return { discovery, error, retry: () => retry((n) => n + 1) };
}

export function VocabularyRead({ repo, error, retry }: { repo: string; error: string | null; retry: () => void }) {
  return error ? <Alert tone="danger" title="Could not read vocabulary" action={<Button {...kind('other')} onClick={retry}>Retry</Button>}>{error}</Alert>
    : <p role="status" className="m-0 text-sm text-base-700">Reading existing {trackerCapabilities(repo).heading.toLowerCase()} and types…</p>;
}

function vocabularyAccess(setup: VocabularyAccess) {
  const options = setup.azureReadOnly === undefined ? {} : { azureReadOnly: setup.azureReadOnly };
  return { labels: writeAccessProblem(setup.repo, 'tag-ticket', setup.access, options), newLabels: newLabelProblem(setup.repo, setup.access, options), types: writeAccessProblem(setup.repo, 'type-ticket', setup.access, options) };
}

const unavailable = (capability: VocabularyCapability) => capability.state === 'available' ? null : capability.reason;

/** Without onCommit this edits onboarding drafts only. A Project commits one complete kind on close or Create. */
export function VocabularyFields({ name, setup, discovery, value, newLabels, disabled = false, onChange, onCommit, onRecheck, error }: {
  name: VocabularyKind; setup: VocabularyAccess; discovery: VocabularyDiscovery; value: VocabularyTerm; newLabels: string[];
  disabled?: boolean; onChange: (value: VocabularyTerm, newLabels: string[]) => void;
  onCommit?: ((value: VocabularyTerm, newLabels: string[]) => void) | undefined;
  onRecheck?: (() => void) | undefined; error?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const changed = useRef(false);
  const latest = useRef({ value, newLabels, onCommit });
  latest.current = { value, newLabels, onCommit };
  useEffect(() => () => {
    if (changed.current) latest.current.onCommit?.(latest.current.value, latest.current.newLabels);
  }, []);
  const access = vocabularyAccess(setup);
  const labelsProblem = unavailable(discovery.labels) ?? access.labels;
  const typesProblem = unavailable(discovery.types) ?? access.types;
  const { noun, heading } = trackerCapabilities(setup.repo);
  const plural = heading.toLowerCase();
  const labels = discovery.labels.state === 'available' ? discovery.labels.choices.filter((label) => kindMappingOffers(setup.repo, label)) : [];
  const types = discovery.types.state === 'available' ? discovery.types.choices : [];
  const title = KIND_NAMES[name];
  const chosen = [...value.labels, ...newLabels];
  const suggestions = suggestVocabularyLabels(discovery.labels)[name]?.labels ?? [];
  const suggested = !labelsProblem && !chosen.length ? suggestions[0] : undefined;
  const offered = [...new Set([...suggestions, ...chosen, ...labels])].filter((label) => chosen.includes(label) || labels.includes(label));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = offered.filter((label) => words.every((word) => label.toLowerCase().includes(word)));
  const typed = query.trim();
  const canCreate = !!typed && !offered.some((label) => label.toLowerCase() === typed.toLowerCase());
  const createProblem = labelsProblem ?? access.newLabels ?? typedLabelsProblem(setup.repo, [typed]);
  const update = (term: VocabularyTerm, fresh = newLabels, commit = !open) => {
    onChange(term, fresh);
    if (commit) { changed.current = false; onCommit?.(term, fresh); }
    else changed.current = true;
  };
  const toggle = (label: string) => {
    if (newLabels.includes(label)) update(value, newLabels.filter((item) => item !== label));
    else update({ ...value, labels: value.labels.includes(label) ? value.labels.filter((item) => item !== label) : [...value.labels, label] });
  };
  const close = (next: boolean) => {
    setOpen(next);
    if (!next && changed.current) { changed.current = false; onCommit?.(value, newLabels); }
    if (next) { setQuery(''); setActive(0); changed.current = false; }
  };
  const choose = (label: string | undefined) => {
    if (label && (!labelsProblem || chosen.includes(label))) toggle(label);
  };
  const at = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => { if (open) document.getElementById(`label-${name}-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [open, name, at, query]);
  const gone = (label: string) => discovery.labels.state === 'available' && !discovery.labels.choices.includes(label) && !newLabels.includes(label);
  return <div data-vocabulary={name} className="grid min-w-0 gap-2 px-3 py-3">
    <div className="grid min-w-0 items-center gap-x-3 gap-y-2 grid-cols-[minmax(0,1fr)_8.5rem] sm:grid-cols-[5.5rem_8.5rem_minmax(0,1fr)]">
      <span className="text-[13px] font-medium">{title}</span>
      <FormSelect aria-label={`${title} type`} writesOnPick value={value.type ?? ''} none="No type" disabled={disabled || (!types.length && !value.type)}
        onChange={(type) => update({ ...value, type: type || null }, newLabels, true)} choices={[
          ...value.type && !types.includes(value.type) ? [{ value: value.type, name: `${value.type} (unavailable)`, disabled: true }] : [],
          ...types.map((type) => ({ value: type, name: type, disabled: !!typesProblem })),
        ]} />
      <div role="group" aria-label={`${title} ${plural}`} className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-span-1">
        {chosen.slice(0, 2).map((label) => <Badge key={label} className="max-w-40 min-w-0"><span className="inline-flex min-w-0 items-center gap-1">
          <span className="truncate" title={label}>{label}{newLabels.includes(label) ? ' (new)' : gone(label) ? ' (unavailable)' : ''}</span>
          <button type="button" className="cursor-pointer bg-transparent p-0" aria-label={`Remove ${label} from ${title}`} disabled={disabled} onClick={() => toggle(label)}>×</button>
        </span></Badge>)}
        {chosen.length > 2 && <button type="button" className="cursor-pointer rounded-full bg-(--muted) px-2 text-xs" aria-label={`${chosen.length - 2} more ${title} ${plural}`} onClick={() => close(true)}>+{chosen.length - 2}</button>}
        {!chosen.length && !suggested && <span className="text-xs text-(--muted-foreground)">None</span>}
        {suggested && <button type="button" disabled={disabled} className="cursor-pointer rounded-full border border-dashed border-(--border) px-2 py-0.5 text-xs" onClick={() => update({ ...value, labels: [suggested] })}>+ {suggested} · suggested</button>}
        <Popover open={open} onOpenChange={close}>
          <Popover.Trigger asChild><Button {...kind('control')} disabled={disabled} className="ms-auto" aria-label={`Choose ${title} ${plural}`}>{chosen.length ? 'Edit' : `Add ${noun}`}</Button></Popover.Trigger>
          <Popover.Content align="end">
            <div className="grid w-80 max-w-[calc(100vw-3rem)] gap-2" data-label-picker={name}>
              <Input autoFocus type="search" role="combobox" aria-expanded aria-controls={`labels-${name}`} aria-activedescendant={matches[at] ? `label-${name}-${at}` : undefined}
                aria-label={`Search ${plural} for ${title}`} placeholder={`Search ${labels.length} ${plural}`} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                onKeyDown={(event) => {
                  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) event.preventDefault();
                  if (event.key === 'ArrowDown') setActive(Math.min(at + 1, matches.length - 1));
                  if (event.key === 'ArrowUp') setActive(Math.max(at - 1, 0));
                  if (event.key === 'Home') setActive(0);
                  if (event.key === 'End') setActive(matches.length - 1);
                  if (event.key === 'Enter') choose(matches[at]);
                }} />
              <ul id={`labels-${name}`} role="listbox" aria-multiselectable aria-label={`${title} ${plural}`} className="m-0 h-64 list-none overflow-y-auto overscroll-contain p-0" onWheel={(event) => event.stopPropagation()}>
                {matches.map((label, index) => <li key={label} id={`label-${name}-${index}`} role="option" aria-selected={chosen.includes(label)} aria-disabled={!!labelsProblem && !chosen.includes(label)}
                  className={`cursor-pointer rounded px-2 py-1 text-[13px] wrap-anywhere ${index === at ? 'bg-(--muted)' : ''}`}
                  onMouseMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(label)}>
                  {chosen.includes(label) ? '✓ ' : ''}{label}{gone(label) ? ' (unavailable)' : ''}
                </li>)}
                {!matches.length && <li role="status" className="px-2 py-2 text-xs text-(--muted-foreground)">{typed ? `No ${plural} match "${typed}".` : `This Project has no ${plural} yet.`}</li>}
              </ul>
              {canCreate && <Button {...kind('other')} disabled={!!createProblem || disabled} onClick={() => {
                if (createProblem) return;
                update(value, [...newLabels, typed], !!onCommit);
                if (!onCommit) setQuery('');
              }}>{onCommit ? `Create "${typed}"` : `Create "${typed}" when you add the Project`}</Button>}
              {canCreate && createProblem && <AccessReason reason={createProblem} onRecheck={onRecheck} />}
              <div className="flex justify-between gap-2 border-t border-(--border) pt-2"><Button {...kind('other')} onClick={() => update(emptyVocabularyTerm(), [])}>None</Button><Button {...kind('other')} onClick={() => close(false)}>Done</Button></div>
            </div>
          </Popover.Content>
        </Popover>
      </div>
    </div>
    {labelsProblem && <AccessReason reason={labelsProblem} onRecheck={onRecheck} />}
    {typesProblem && <AccessReason reason={typesProblem} onRecheck={discovery.types.state === 'unsupported' ? undefined : onRecheck} />}
    {!types.length && !typesProblem && <span className="text-xs text-(--muted-foreground)">This Project has no {discovery.provider === 'azure' ? 'work item' : 'issue'} types.</span>}
    {value.type && (typesProblem || !types.includes(value.type)) && <span className="text-xs"><Button {...kind('other')} onClick={() => update({ ...value, type: null }, newLabels, true)}>Remove {value.type}</Button></span>}
    {error && <p role="alert" className="m-0 text-xs text-(--error-foreground)">{error} <button type="button" className="cursor-pointer bg-transparent p-0 underline" onClick={() => { changed.current = false; onCommit?.(value, newLabels); }}>Retry</button></p>}
  </div>;
}

function VocabularySettings({ setup }: { setup: RepositorySetup }) {
  const { discovery, error, retry } = useVocabularyDiscovery(setup.repo);
  const { vocabulary, vocabularyDrafts, vocabularyErrors, draftVocabulary, recheck } = useEditStore();
  if (!discovery) return <VocabularyRead repo={setup.repo} error={error} retry={retry} />;
  return <div className="grid min-w-0 gap-2">
    {error && <VocabularyRead repo={setup.repo} error={error} retry={retry} />}
    <div className={FIELD_GROUP}>
    {(Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => {
      const draft = vocabularyDrafts[setup.repo]?.[key];
      return <VocabularyFields key={key} name={key} setup={setup} discovery={discovery} value={draft?.value ?? setup.vocabulary[key]} newLabels={draft?.newLabels ?? []}
        error={vocabularyErrors[setup.repo]?.[key]} onChange={(value, newLabels) => draftVocabulary(setup.repo, key, value, newLabels)}
        onRecheck={() => { void recheck(setup.repo); }} onCommit={(value, newLabels) => { void vocabulary(setup.repo, key, value, newLabels); }} />;
    })}
    </div>
  </div>;
}

export function EditVocabulary({ setup }: { setup: RepositorySetup }) {
  return <section className="grid min-w-0 gap-3" aria-label="Kind vocabulary">
    <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">Kinds and {trackerCapabilities(setup.repo).heading.toLowerCase()}
      <HelpTip title="kind mapping">Map bugs, features and improvements to existing {trackerCapabilities(setup.repo).heading.toLowerCase()} and types. Suggestions are optional.</HelpTip>
    </h3>
    <VocabularySettings setup={setup} />
  </section>;
}
