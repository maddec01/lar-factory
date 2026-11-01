import { type SetupDetection } from '@lar-factory/shared';
import { emptyVocabularyTerm } from '@lar-factory/shared/vocabulary';
import { KIND_NAMES, useVocabularyDiscovery, VocabularyFields, VocabularyRead, type VocabularyKind } from '../repositories/vocabulary-editor.tsx';
import { useWizardStore, type Run } from './wizard-store.ts';

export function VocabularyStep({ run, detection }: { run: Run; detection: SetupDetection }) {
  const choose = useWizardStore((s) => s.choose);
  const { discovery, error, retry } = useVocabularyDiscovery(run.repo!, true);
  return <div className="grid gap-4">
    <p className="m-0 text-sm text-base-700">Optional. Choose labels and types for each kind, or continue without a mapping. Suggestions apply only when you choose them.</p>
    <p className="m-0 text-xs text-base-700">New labels are created only when you choose Save and add repository. You can edit these mappings later in Settings.</p>
    {!discovery ? <VocabularyRead error={error} retry={retry} /> : (Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => <div key={key} data-vocabulary={key}>
      <VocabularyFields name={key} setup={detection} discovery={discovery} value={run.choices.vocabulary?.[key] ?? emptyVocabularyTerm()}
        newLabels={run.choices.newLabels?.[key] ?? []} onChange={(value, names) => {
          const newLabels: NonNullable<Run['choices']['newLabels']> = { ...run.choices.newLabels };
          delete newLabels[key];
          if (names.some((name) => name.trim())) newLabels[key] = names;
          choose({ vocabulary: { ...run.choices.vocabulary, [key]: value }, newLabels: Object.keys(newLabels).length ? newLabels : undefined });
        }} />
    </div>)}
  </div>;
}
