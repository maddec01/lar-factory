import { useState } from 'react';
import { trackerCapabilities, type SetupDetection } from '@lar-factory/shared';
import { emptyVocabularyTerm, type VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { KIND_NAMES, useVocabularyDiscovery, VocabularyFields, VocabularyRead, type VocabularyKind } from '../repositories/vocabulary-editor.tsx';
import { useWizardStore, type Run } from './wizard-store.ts';

/** What a mapping can choose: every label the tracker has but the one sync needs, which is never optional. */
function withoutSyncLabel(discovery: VocabularyDiscovery, syncLabel: string | null): VocabularyDiscovery {
  if (discovery.labels.state !== 'available') return discovery;
  return { ...discovery, labels: { ...discovery.labels, choices: discovery.labels.choices.filter((name) => name !== syncLabel) } };
}

function KindMappingFields({ run, detection }: { run: Run; detection: SetupDetection }) {
  const choose = useWizardStore((s) => s.choose);
  const { discovery, error, retry } = useVocabularyDiscovery(run.repo!, true);
  const { syncLabel } = trackerCapabilities(detection.repo);
  return !discovery ? <VocabularyRead error={error} retry={retry} /> : (Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => <div key={key} data-vocabulary={key}>
    <VocabularyFields name={key} setup={detection} discovery={withoutSyncLabel(discovery, syncLabel)} value={run.choices.vocabulary?.[key] ?? emptyVocabularyTerm()}
      newLabels={run.choices.newLabels?.[key] ?? []} onChange={(value, names) => {
        const newLabels: NonNullable<Run['choices']['newLabels']> = { ...run.choices.newLabels };
        delete newLabels[key];
        if (names.some((name) => name.trim())) newLabels[key] = names;
        choose({ vocabulary: { ...run.choices.vocabulary, [key]: value }, newLabels: Object.keys(newLabels).length ? newLabels : undefined });
      }} />
  </div>);
}

/** Folded and reading nothing until opened, unless a kept draft could be what holds Next back. */
export function KindMapping({ run, detection }: { run: Run; detection: SetupDetection }) {
  const [open, setOpen] = useState(() => !!run.choices.vocabulary || !!run.choices.newLabels);
  const labels = trackerCapabilities(detection.repo).heading.toLowerCase();
  return <details data-kind-mapping open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-lg border px-4 py-3">
    <summary className="cursor-pointer text-sm font-medium">Map kinds to {labels} and types <Badge className="ms-1">Optional</Badge></summary>
    {open && <div className="mt-4 grid gap-4">
      <p className="m-0 text-xs text-base-700">Skip this if you like. Without a mapping, new tickets get no {labels} from their kind. New {labels} are created only when you choose Save and add repository. You can edit these mappings later in Settings.</p>
      <KindMappingFields run={run} detection={detection} />
    </div>}
  </details>;
}
