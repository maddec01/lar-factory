import { useEffect, useId, useRef } from 'react';
import { resolveVocabulary, sameRepo, type BoardData, type Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { kind } from '../buttons/button-kinds.tsx';
import { usePublicationStore } from './publication-store.ts';
import { PublicationSetup } from './publication-setup.tsx';
import { PublicationDocuments } from './publication-documents.tsx';
import { PublicationPreview } from './publication-preview.tsx';
import { VocabularyTypeChoice } from './vocabulary-editor.tsx';
import { PublicationConflict } from './publication-conflict.tsx';

export function PublishButton({ item, data }: { item: Item; data: BoardData }) {
  const reasonId = useId();
  if (!item.publication) return null;
  const reason = data.capture?.enabled === false ? 'Publishing is disabled in sample mode. Your private work remains available.'
    : !item.publication.eligible ? item.publication.reasons.join(' ') : null;
  const disabled = data.capture?.enabled === false || !item.publication.eligible && !item.publication.recoverable;
  return <span className="inline-flex flex-wrap items-center gap-2">
    <Button {...kind('other')} data-publish={item.id} disabled={disabled} aria-describedby={reason ? reasonId : undefined}
      onClick={() => void usePublicationStore.getState().open(item.id)}>Publish</Button>
    {reason && <span id={reasonId} className="max-w-sm text-xs text-base-700">{reason}</span>}
  </span>;
}

function PublicationContent() {
  const { state, workId, open, busy, mode, documents, typeSelections, chooseType, setMode, prepare, request } = usePublicationStore();
  if (!state) return busy ? <p className="m-0 text-sm">Reading publication from the journal…</p> : <span><Button {...kind('other')} onClick={() => void open(workId!)}>Reload publication</Button></span>;
  if (!state.readiness.eligible && !state.pending) return <Alert tone="warning" title="This work cannot publish yet">{state.readiness.reasons.join(' ')}</Alert>;
  if (mode === 'setup') return <PublicationSetup />;
  if (mode === 'preview' && state.pending) return <PublicationPreview />;
  const resolutions = state.sources.map((source) => {
    const setup = state.settings.find((item) => sameRepo(item.setup.repo, source.repository))!.setup;
    return { source, resolution: resolveVocabulary(setup.vocabulary, source.kind === 'concept' ? 'concept' : 'build',
      ['bug', 'feature', 'improvement', 'concept'].includes(source.kind) ? source.kind as 'bug' | 'feature' | 'improvement' | 'concept' : undefined, typeSelections[source.workId]) };
  });
  const complete = documents.every((doc) => doc.title.trim() && doc.outcome.trim() && doc.change.trim() && (state.sources.find((source) => source.workId === doc.workId)?.kind === 'concept' || doc.checks.some((check) => check.trim())) && doc.decisions.every((d) => d.decision.trim() && d.reason.trim()));
  return <>
    <PublicationDocuments />
    {resolutions.map(({ source, resolution }) => <section key={source.workId} aria-label={`Type for ${source.title}`}>
      <h3 className="m-0 mb-2 text-sm font-medium">{source.title} in {source.repository}</h3>
      <VocabularyTypeChoice resolution={resolution} onChoose={(type) => chooseType(source.workId, type)} />
    </section>)}
    <div className="flex flex-wrap gap-2">
      <Button {...kind('other')} disabled={busy} onClick={() => setMode('setup')}>Review Vocabulary and access</Button>
      <Button {...kind('other')} disabled={busy} onClick={() => void request('open').then((ok) => { if (ok) setMode('edit'); })}>Refresh refinement and settings</Button>
      <Button {...kind('main')} disabled={busy || !complete || resolutions.some(({ resolution }) => !resolution.ready)} onClick={() => void prepare()}>Preview publication</Button>
    </div>
  </>;
}

export function PublicationDialog() {
  const { workId, busy, error, refused, conflict, state, mode, close } = usePublicationStore();
  const heading = useRef<HTMLDivElement>(null);
  // The copied modal owns focus trapping and return focus. Step changes focus the new question.
  useEffect(() => { heading.current?.focus(); }, [mode]);
  if (!workId) return null;
  return <Modal onClose={close} loading={busy}>
    <Modal.Content title="Publish refinement" data-publication-dialog presentation="workspace">
      <Modal.Body><div ref={heading} tabIndex={-1} className="grid min-w-0 gap-4 outline-none">
        <p className="m-0 text-sm text-base-700">Publication is optional. It keeps your private work and does not start a build or change Status.</p>
        {busy && <p role="status" className="m-0 text-sm">Reading or saving publication. Wait for its stored outcome.</p>}
        {error && <Alert tone="danger" title={refused ? 'Refused' : 'Publication needs attention'}>{error}</Alert>}
        {(conflict ? [conflict] : state?.pending?.conflicts ?? []).map((item) => <PublicationConflict key={`${item.workId}:${item.current}`} conflict={item} />)}
        <PublicationContent />
      </div></Modal.Body>
      <Modal.Footer><Button {...kind('other')} disabled={busy} onClick={close}>Cancel</Button></Modal.Footer>
    </Modal.Content>
  </Modal>;
}
