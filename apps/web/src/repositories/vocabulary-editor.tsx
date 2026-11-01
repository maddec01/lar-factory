import { useEffect, useId, useState } from 'react';
import { writeAccessProblem, type RepositorySetup, type VocabularyTerm } from '@lar-factory/shared';
import { emptyVocabularyTerm, suggestVocabularyLabels, type VocabularyCapability, type VocabularyDiscovery, type VocabularyMapping } from '@lar-factory/shared/vocabulary';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { NativeSelect } from '@lar-factory/ui/native-select';
import { kind } from '../buttons/button-kinds.tsx';
import { postAction } from '../items/card-actions.ts';
import { useEditStore } from './edit-store.ts';

export const KIND_NAMES = { bug: 'Bug', feature: 'Feature', improvement: 'Improvement' } as const;
export type VocabularyKind = keyof typeof KIND_NAMES;
type VocabularyAccess = Pick<RepositorySetup, 'repo' | 'access' | 'azureReadOnly'>;

/** Discovery stays read-only; suggestions never become a mapping until the user chooses them. */
export function useVocabularyDiscovery(repo: string, onboarding = false) {
  const [discovery, setDiscovery] = useState<VocabularyDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let current = true;
    setDiscovery(null);
    setError(null);
    void postAction<{ discovery: VocabularyDiscovery }>(onboarding ? '/api/onboarding/vocabulary' : '/api/repositories/settings',
      onboarding ? { repo } : { repo, change: 'discover-vocabulary' }).then((result) => {
      if (!current) return;
      if (result.error || !result.discovery) setError(result.error ?? 'The board sent no vocabulary.');
      else setDiscovery(result.discovery);
    });
    return () => { current = false; };
  }, [repo, onboarding, attempt]);
  return { discovery, error, retry: () => retry((n) => n + 1) };
}

export function VocabularyRead({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? <Alert tone="danger" title="Could not read vocabulary" action={<Button {...kind('other')} onClick={retry}>Retry</Button>}>{error}</Alert>
    : <p role="status" className="m-0 text-sm text-base-700">Reading existing labels and types…</p>;
}

function unavailable(capability: VocabularyCapability): string | null {
  return capability.state === 'available' ? null : `${capability.state === 'refused' ? 'Read refused' : 'Unavailable'}. ${capability.reason}`;
}

function vocabularyAccess(setup: VocabularyAccess) {
  const options = setup.azureReadOnly === undefined ? {} : { azureReadOnly: setup.azureReadOnly };
  return { labels: writeAccessProblem(setup.repo, 'tag-ticket', setup.access, options), types: writeAccessProblem(setup.repo, 'type-ticket', setup.access, options) };
}

/** An explicit none can always clear a stale or forbidden mapping. */
export function VocabularyFields({ name, setup, discovery, value, newLabels, disabled = false, onChange }: {
  name: VocabularyKind; setup: VocabularyAccess; discovery: VocabularyDiscovery; value: VocabularyTerm; newLabels: string[];
  disabled?: boolean; onChange: (value: VocabularyTerm, newLabels: string[]) => void;
}) {
  const id = useId();
  const access = vocabularyAccess(setup);
  const labelsProblem = [unavailable(discovery.labels), access.labels].filter(Boolean).join(' ');
  const typesProblem = [unavailable(discovery.types), access.types].filter(Boolean).join(' ');
  const labels = discovery.labels.state === 'available' ? discovery.labels.choices : [];
  const types = discovery.types.state === 'available' ? discovery.types.choices : [];
  const suggested = suggestVocabularyLabels(discovery.labels)[name]?.labels[0];
  const title = KIND_NAMES[name];
  return <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 rounded-lg border p-3">
    <legend className="px-1 text-sm font-medium">{title}</legend>
    <label className="grid gap-1.5 text-sm">{discovery.provider === 'azure' ? 'Work item type' : 'Issue type'}
      <NativeSelect aria-label={`${title} type`} aria-describedby={typesProblem ? `${id}-types` : undefined} value={value.type ?? ''}
        onChange={(e) => onChange({ ...value, type: e.target.value || null }, newLabels)}>
        <option value="">None</option>
        {value.type && !types.includes(value.type) && <option disabled value={value.type}>{value.type} (unavailable)</option>}
        {types.map((type) => <option key={type} disabled={!!typesProblem} value={type}>{type}</option>)}
      </NativeSelect>
    </label>
    {typesProblem && <p id={`${id}-types`} className="m-0 text-xs text-base-700">{typesProblem}</p>}
    <div className="grid gap-2" role="group" aria-label={`${title} ${discovery.provider === 'azure' ? 'tags' : 'labels'}`} aria-describedby={labelsProblem ? `${id}-labels` : undefined}>
      <span className="text-sm">{discovery.provider === 'azure' ? 'Tags' : 'Labels'}</span>
      {[...new Set([...labels, ...value.labels])].map((label) => <Checkbox key={label} label={label} checked={value.labels.includes(label)} disabled={!!labelsProblem || !labels.includes(label)}
        onChange={() => onChange({ ...value, labels: value.labels.includes(label) ? value.labels.filter((v) => v !== label) : [...value.labels, label] }, newLabels)} />)}
      {!labels.length && !labelsProblem && <p className="m-0 text-xs text-base-700">No existing labels or tags.</p>}
      {labelsProblem && <p id={`${id}-labels`} className="m-0 text-xs text-base-700">{labelsProblem}</p>}
      {suggested && !labelsProblem && !value.labels.includes(suggested) && <span><Button {...kind('other')} onClick={() => onChange({ ...value, labels: [...value.labels, suggested] }, newLabels)}>Use suggested label: {suggested}</Button></span>}
    </div>
    <label className="grid gap-1.5 text-sm">New {discovery.provider === 'azure' ? 'tag' : 'label'}
      <Input type="text" aria-label={`${title} new label`} aria-describedby={`${id}-new`} maxLength={100} disabled={!!labelsProblem} value={newLabels[0] ?? ''}
        onChange={(e) => onChange(value, e.target.value ? [e.target.value] : [])} />
    </label>
    <p id={`${id}-new`} className="m-0 text-xs text-base-700">Created only when you save. Leave empty to use existing labels or none.</p>
    <span><Button {...kind('other')} onClick={() => onChange(emptyVocabularyTerm(), [])}>None</Button></span>
  </fieldset>;
}

function VocabularySettings({ setup }: { setup: RepositorySetup }) {
  const { discovery, error, retry } = useVocabularyDiscovery(setup.repo);
  const { running, vocabulary, errors } = useEditStore();
  const [drafts, setDrafts] = useState<VocabularyMapping>({});
  const [newLabels, setNewLabels] = useState<Partial<Record<VocabularyKind, string[]>>>({});
  const [saved, setSaved] = useState<VocabularyKind | null>(null);
  if (!discovery) return <VocabularyRead error={error} retry={retry} />;
  const access = vocabularyAccess(setup);
  return <div className="grid gap-4">
    {(Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => {
      const value = drafts[key] ?? setup.vocabulary[key];
      const names = (newLabels[key] ?? []).map((name) => name.trim()).filter(Boolean);
      const forbidden = value.type !== null && access.types || (value.labels.length > 0 || names.length > 0) && access.labels;
      return <div key={key} data-vocabulary={key} className="grid gap-2">
        <VocabularyFields name={key} setup={setup} discovery={discovery} value={value} newLabels={newLabels[key] ?? []} disabled={running !== null}
          onChange={(term, labels) => { setDrafts({ ...drafts, [key]: term }); setNewLabels({ ...newLabels, [key]: labels }); setSaved(null); }} />
        <span><Button {...kind('other')} disabled={running !== null || !drafts[key] || !!forbidden} onClick={async () => {
          if (await vocabulary(setup.repo, key, value, names)) {
            setDrafts(({ [key]: _, ...rest }) => rest);
            setNewLabels(({ [key]: _, ...rest }) => rest);
            setSaved(key);
            retry();
          }
        }}>Save</Button></span>
        {drafts[key] && errors[setup.repo] && <Alert tone="danger" title="Could not save vocabulary">{errors[setup.repo]}</Alert>}
        {saved === key && <p role="status" className="m-0 text-xs text-base-700">Saved.</p>}
      </div>;
    })}
  </div>;
}

export function EditVocabulary({ setup }: { setup: RepositorySetup }) {
  const [open, setOpen] = useState(false);
  return <section className="grid gap-3" aria-label="Kind vocabulary">
    <p className="m-0 text-sm">Map bugs, features and improvements to existing labels and types. Suggestions are optional.</p>
    {open ? <VocabularySettings setup={setup} /> : <span><Button {...kind('other')} onClick={() => setOpen(true)}>Edit vocabulary</Button></span>}
  </section>;
}
