import { useState } from 'react';
import { VOCABULARY_KEYS, type RepositorySetup, type VocabularyDiscovery } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { VocabularyEditor } from './vocabulary-editor.tsx';
import { useEditStore } from '../repositories/edit-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

const SOURCES = { local: 'Set on this Mac', shared: 'Shared default', default: 'Factory default' };

/** Vocabulary stays optional. Detection runs only when the user opens its editor. */
export function VocabularySettings({ setup }: { setup: RepositorySetup }) {
  const [discovery, setDiscovery] = useState<VocabularyDiscovery | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { vocabulary, running, errors } = useEditStore();
  async function open() {
    setReading(true); setError(null);
    try {
      const response = await fetch(`/api/publication/vocabulary?repo=${encodeURIComponent(setup.repo)}`);
      const result = await response.json() as { discovery: VocabularyDiscovery; error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? 'Could not discover Vocabulary.');
      setDiscovery(result.discovery);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReading(false); }
  }
  return <div data-setting="vocabulary" className="grid gap-2">
    <span className="text-sm font-medium">Vocabulary</span>
    <p className="m-0 text-xs text-base-700">How concepts, builds and kinds become team terms when you choose to publish.</p>
    {discovery ? <VocabularyEditor setup={setup} discovery={discovery} busy={running !== null} error={errors[setup.repo]}
      onSave={(key, value) => vocabulary(setup.repo, key, value)} onDone={() => setDiscovery(null)} /> : <>
      <ul className="m-0 list-none p-0 text-xs">
        {VOCABULARY_KEYS.map((key) => <li key={key} data-mapping={key}>{key === 'concept-kind' ? 'Kind concept' : key}: {setup.vocabulary[key].type ?? 'no type'}; {setup.vocabulary[key].labels.join(', ') || 'no labels or tags'}
          <span data-source className="ml-2 text-base-700">{SOURCES[setup.vocabularySources[key]]}</span>
        </li>)}
      </ul>
      <Button {...kind('other')} disabled={reading || running !== null} onClick={() => void open()}>Edit Vocabulary</Button>
    </>}
    {discovery && <Button {...kind('other')} disabled={running !== null} onClick={() => setDiscovery(null)}>Close Vocabulary</Button>}
    {error && <Alert tone="danger" title="Could not discover Vocabulary">{error}</Alert>}
  </div>;
}
