import { useEffect, useRef, useState } from 'react';
import {
  VOCABULARY_KEYS, emptyVocabularyTerm, type RepositorySetup, type VocabularyCapability, type VocabularyDiscovery,
  type VocabularyKey, type VocabularyResolution, type VocabularyTerm,
} from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Choice, Group } from '../onboarding/setup-fields.tsx';
import { kind } from '../buttons/button-kinds.tsx';

const NAMES: Record<VocabularyKey, string> = { concept: 'concepts', build: 'builds', bug: 'bugs', feature: 'features', improvement: 'improvements', 'concept-kind': 'items of kind concept' };
const SOURCES = { local: 'Set on this Mac', shared: 'Shared default', default: 'Factory default' };

function Capability({ name, capability }: { name: string; capability: VocabularyCapability }) {
  return <p className="m-0 text-sm" data-capability={name}>{name}: {capability.state === 'available'
    ? capability.choices.length ? capability.choices.join(', ') : 'Available, no choices found'
    : `${capability.state === 'refused' ? 'Refused' : 'Unavailable'}: ${capability.reason}`}</p>;
}

/** Reused by Settings and first publication. Saving changes local mappings only, never provider content. */
export function VocabularyEditor({ setup, discovery, onSave, onDone, busy = false, error }: {
  setup: RepositorySetup; discovery: VocabularyDiscovery;
  onSave: (key: VocabularyKey, term: VocabularyTerm | undefined) => Promise<boolean>;
  onDone: () => void; busy?: boolean; error?: string;
}) {
  const [step, setStep] = useState(-1);
  const [saved, setSaved] = useState<Partial<Record<VocabularyKey, VocabularyTerm | null>>>({});
  const vocabulary = { ...setup.vocabulary };
  const vocabularySources = { ...setup.vocabularySources };
  for (const key of VOCABULARY_KEYS) {
    const term = saved[key];
    if (term === undefined) continue;
    vocabulary[key] = term ?? setup.shared.vocabulary?.[key] ?? emptyVocabularyTerm();
    vocabularySources[key] = term !== null ? 'local' : setup.shared.vocabulary?.[key] ? 'shared' : 'default';
  }
  async function save(key: VocabularyKey, term: VocabularyTerm | undefined) {
    if (!await onSave(key, term)) return false;
    setSaved((previous) => ({ ...previous, [key]: term ?? null }));
    return true;
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const key = VOCABULARY_KEYS[Math.floor(step / 2)];
  const labels = discovery.provider === 'azure' ? 'tags' : 'labels';
  return <div data-vocabulary-editor className="grid gap-3">
    <h3 tabIndex={-1} ref={heading} className="m-0 text-sm font-medium">{step < 0 ? 'What we found' : `Vocabulary ${step + 1} of ${VOCABULARY_KEYS.length * 2}`}</h3>
    {error && <Alert tone="danger" title="Could not save Vocabulary">{error}</Alert>}
    {step < 0 ? <>
      <Capability name="Types" capability={discovery.types} /><Capability name={labels} capability={discovery.labels} />
      <p className="m-0 text-xs text-base-700">Choose how the team names concepts, builds and each kind. Publication will ask for write permission and approval of the exact content later.</p>
      <Button {...kind('other')} onClick={() => setStep(0)}>Next</Button>
    </> : key && <MappingQuestion key={step} mappingKey={key} field={step % 2 === 0 ? 'type' : 'labels'} setup={{ ...setup, vocabulary, vocabularySources }}
      discovery={discovery} busy={busy} onSave={save} onBack={() => setStep(step - 1)}
      onNext={() => step === VOCABULARY_KEYS.length * 2 - 1 ? onDone() : setStep(step + 1)} />}
  </div>;
}

function MappingQuestion({ mappingKey, field, setup, discovery, onSave, onNext, onBack, busy }: {
  mappingKey: VocabularyKey; field: 'type' | 'labels'; setup: RepositorySetup; discovery: VocabularyDiscovery;
  onSave: (key: VocabularyKey, value: VocabularyTerm | undefined) => Promise<boolean>;
  onNext: () => void; onBack: () => void; busy: boolean;
}) {
  const capability = discovery[field === 'type' ? 'types' : 'labels'];
  const names = capability.state === 'available' ? capability.choices : [];
  const current = setup.vocabulary[mappingKey];
  const detected = names.find((name) => name.toLowerCase() === (mappingKey === 'concept-kind' ? 'concept' : mappingKey));
  const initial = setup.vocabularySources[mappingKey] === 'default' && detected
    ? { ...current, [field]: field === 'type' ? detected : [detected] } : current;
  const [term, setTerm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const disabled = busy || saving;
  const name = field === 'type' ? 'type' : discovery.provider === 'azure' ? 'tags' : 'labels';
  const question = `Which ${name} should ${NAMES[mappingKey]} use?`;
  const selected = field === 'type' ? term.type === null ? [] : [term.type] : term.labels;
  const missing = selected.filter((value) => !names.includes(value));
  async function save(value: VocabularyTerm | undefined) {
    if (value !== undefined && JSON.stringify(value) === JSON.stringify(current)) { onNext(); return; }
    setSaving(true);
    try { if (await onSave(mappingKey, value)) onNext(); }
    finally { setSaving(false); }
  }
  return <div data-vocabulary-question className="grid gap-3">
    <p className="m-0 text-xs text-base-700" data-mapping-source>{SOURCES[setup.vocabularySources[mappingKey]]}</p>
    {capability.state !== 'available' && <Capability name={name} capability={capability} />}
    <Group legend={question}>
      {field === 'type' ? <RadioGroup aria-label={question} value={term.type ?? ''} onValueChange={(value) => setTerm({ ...term, type: value || null })}>
        <Choice value="" title="Nothing" disabled={disabled}>Adds no provider type for this mapping.</Choice>
        {names.map((value) => <Choice key={value} value={value} title={value} disabled={disabled}>Requests this type. A different kind type needs your choice before publication.</Choice>)}
        {missing.map((value) => <Choice key={value} value={value} title={`${value} · Refused`} disabled>Not available in the detected types. Choose another type or nothing.</Choice>)}
      </RadioGroup> : <div className="grid gap-2">
        {[null, ...names, ...missing].map((value) => <label key={value ?? ''} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Checkbox aria-label={value ?? 'Nothing'} checked={value === null ? term.labels.length === 0 : term.labels.includes(value)} disabled={disabled || value !== null && missing.includes(value)}
            onChange={() => setTerm({ ...term, labels: value === null ? [] : term.labels.includes(value) ? term.labels.filter((v) => v !== value) : [...term.labels, value] })} />
          <span>{value ?? 'Nothing'}<span className="block text-xs text-base-700">{value === null ? `Adds no ${name} for this mapping.` : missing.includes(value) ? `Refused: not available in the detected ${name}.` : `Combines with the other mapped ${name}.`}</span></span>
        </label>)}
      </div>}
    </Group>
    <p className="m-0 text-xs text-base-700">{field === 'type' ? `You choose ${discovery.provider === 'azure' ? 'tags' : 'labels'} next.` : 'Write permission and exact-content approval wait until publication.'}</p>
    <span className="flex flex-wrap gap-2">
      <Button {...kind('other')} disabled={disabled} onClick={onBack}>Back</Button>
      <Button {...kind('other')} disabled={disabled || missing.length > 0} onClick={() => void save(term)}>Save and next</Button>
      {setup.vocabularySources[mappingKey] === 'local' && <Button {...kind('other')} disabled={disabled} onClick={() => void save(undefined)}>
        {setup.shared.vocabulary?.[mappingKey] ? 'Use shared default' : 'Use factory default'}</Button>}
    </span>
  </div>;
}

/** Publication approval must use resolution.ready. Undefined stays unresolved; null explicitly chooses none. */
export function VocabularyTypeChoice({ resolution, onChoose }: { resolution: VocabularyResolution; onChoose: (type: string | null) => void }) {
  if (resolution.ready) return null;
  return <Group legend="Which effective type should this ticket use?">
    <p className="m-0 text-sm">{resolution.requests.map((r) => `${NAMES[r.key]} request ${r.type}`).join('; ')}. Choose before approving publication.</p>
    <RadioGroup aria-label="Effective ticket type" value="pending" onValueChange={(v) => onChoose(v === '' ? null : resolution.candidates[Number(v)]!)}>
      <Choice value="" title="Nothing">Publishes without a provider type.</Choice>
      {resolution.candidates.map((type, index) => <Choice key={type} value={String(index)} title={type}>Uses this type for this publication only.</Choice>)}
    </RadioGroup>
  </Group>;
}
