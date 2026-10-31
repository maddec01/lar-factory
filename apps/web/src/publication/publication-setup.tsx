import { useEffect, useRef, useState } from 'react';
import { REPOSITORY_OPERATIONS, type RepositoryOperation } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { Choice, Group } from '../onboarding/setup-fields.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { VocabularyEditor } from './vocabulary-editor.tsx';
import { usePublicationStore } from './publication-store.ts';

const OPERATIONS: { operation: RepositoryOperation; question: string; cost: string }[] = [
  { operation: 'publish-ticket', question: 'May publication create tickets?', cost: 'Creates the approved tickets in this repository.' },
  { operation: 'edit-ticket', question: 'May publication edit ticket descriptions?', cost: 'Appends or replaces only the approved refinement text.' },
  { operation: 'tag-ticket', question: 'May publication set mapped labels or tags?', cost: 'Adds the approved team terms to tickets.' },
  { operation: 'type-ticket', question: 'May publication set a ticket type?', cost: 'Uses the one effective team type shown in preview.' },
  { operation: 'relate-ticket', question: 'May publication add native relationships?', cost: 'Links the approved parent, children and dependencies.' },
  { operation: 'comment-ticket', question: 'May publication post comments?', cost: 'Posts only comments included in your approved preview.' },
];

/** Each destination gets its own Vocabulary and local consent questions. Nothing here writes provider content. */
export function PublicationSetup() {
  const { state, busy, saveSetting, setMode } = usePublicationStore();
  const [repository, setRepository] = useState(0);
  const [step, setStep] = useState(-1);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [repository, step]);
  const config = state?.settings[repository];
  if (!config) return null;
  const { setup, discovery } = config;
  const next = () => {
    if (step < OPERATIONS.length - 1) setStep(step + 1);
    else if (repository < state!.settings.length - 1) { setRepository(repository + 1); setStep(-1); }
    else setMode('edit');
  };
  return <section className="grid gap-3" data-publication-setup>
    <h3 ref={heading} tabIndex={-1} className="m-0 text-sm font-medium">{setup.repo}</h3>
    {step < 0 ? <VocabularyEditor key={setup.repo} setup={setup} discovery={discovery} busy={busy}
      onSave={(key, value) => saveSetting(setup.repo, { change: 'vocabulary', key, ...value !== undefined && { value } })} onDone={() => setStep(0)} />
      : <ConsentQuestion key={`${setup.repo}:${step}`} config={OPERATIONS[step]!} enabled={setup.consent.includes(OPERATIONS[step]!.operation)}
        refused={setup.access[OPERATIONS[step]!.operation] === 'refused'} busy={busy} onSave={async (enabled) => {
          const operation = OPERATIONS[step]!.operation;
          if (await saveSetting(setup.repo, { change: 'consent', value: REPOSITORY_OPERATIONS.filter((op) => op === operation ? enabled : setup.consent.includes(op)) })) next();
        }} />}
  </section>;
}

function ConsentQuestion({ config, enabled, refused, busy, onSave }: {
  config: typeof OPERATIONS[number]; enabled: boolean; refused: boolean; busy: boolean; onSave: (enabled: boolean) => Promise<void>;
}) {
  const [answer, setAnswer] = useState(enabled && !refused ? 'yes' : 'no');
  return <div className="grid gap-3">
    <Group legend={config.question}>
      <RadioGroup value={answer} onValueChange={setAnswer} aria-label={config.question}>
        <Choice value="no" title="Keep it off">Publication will not offer this operation.</Choice>
        <Choice value="yes" title={refused ? 'Allow · Refused' : 'Allow'} disabled={refused || busy}>
          {refused ? 'Refused: the saved credential check refused this operation. Recheck access in Settings after changing credentials.' : config.cost}
        </Choice>
      </RadioGroup>
    </Group>
    <p className="m-0 text-xs text-base-700">You will approve exact content and operations separately before publication.</p>
    <span><Button {...kind('other')} disabled={busy} onClick={() => void onSave(answer === 'yes')}>Save and next</Button></span>
  </div>;
}
