import { useState } from 'react';
import type { PublicationTextConflict } from '@lar-factory/shared';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Field } from '../onboarding/setup-fields.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { usePublicationStore } from './publication-store.ts';

/** The user selects raw text boundaries. The engine rereads them before recording a new plan. */
export function PublicationConflict({ conflict }: { conflict: PublicationTextConflict }) {
  const { busy, resolveText, chooseDelivery, setMode } = usePublicationStore();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const valid = start !== '' && end !== '' && Number.isSafeInteger(Number(start)) && Number.isSafeInteger(Number(end))
    && Number(start) >= 0 && Number(end) >= Number(start) && Number(end) <= conflict.current.length;
  const choose = (delivery: 'comment' | 'handover') => { chooseDelivery(conflict.workId, delivery); setMode('edit'); };
  return <section className="grid min-w-0 gap-3" data-publication-conflict>
    <Alert tone="warning" title="A teammate changed the published text">{conflict.reason} Review their text before selecting a replacement. A new preview and approval are required.</Alert>
    {([{ label: 'Stored publication', value: conflict.stored }, { label: 'Current provider text', value: conflict.current }, { label: 'Proposed refinement', value: conflict.proposed }]).map(({ label, value }) =>
      <div key={label}><h3 className="m-0 text-sm font-medium">{label}</h3><pre className="m-0 whitespace-pre-wrap break-words text-xs">{value || 'No text.'}</pre></div>)}
    <p className="m-0 text-xs">Recorded location: {conflict.location.kind === 'comment' ? `comment ${conflict.location.commentId}` : `${conflict.location.field ?? 'description'}, characters ${conflict.location.start} to ${conflict.location.end}`}.</p>
    {conflict.location.kind === 'body' ? <>
      <p className="m-0 text-sm">Select character offsets in the current raw text. Only this range will change. Offsets start at zero and exclude the ending character.</p>
      <Field label="Replacement start">{(props) => <Input {...props} type="number" min="0" max={conflict.current.length} value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} />}</Field>
      <Field label="Replacement end">{(props) => <Input {...props} type="number" min="0" max={conflict.current.length} value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} />}</Field>
      {valid && <pre className="m-0 whitespace-pre-wrap break-words text-xs" data-resolution-selection>{conflict.current.slice(Number(start), Number(end)) || 'Empty range. Append at this position.'}</pre>}
      <span><Button {...kind('other')} disabled={busy || !valid} onClick={() => resolveText(conflict, { ...conflict.location as Extract<typeof conflict.location, { kind: 'body' }>, start: Number(start), end: Number(end) })}>Use selected range</Button></span>
      <span><Button {...kind('other')} disabled={busy} onClick={() => resolveText(conflict, { ...conflict.location as Extract<typeof conflict.location, { kind: 'body' }>, start: conflict.current.length, end: conflict.current.length })}>Keep current text and append</Button></span>
    </> : conflict.current && <span><Button {...kind('other')} disabled={busy} onClick={() => resolveText(conflict, conflict.location)}>Replace this comment in a new preview</Button></span>}
    <div className="flex flex-wrap gap-2">
      <Button {...kind('other')} disabled={busy} onClick={() => choose('comment')}>Choose a new comment</Button>
      <span className="text-xs">Cost: leaves teammate edits intact and posts a separately approved comment.</span>
      <Button {...kind('other')} disabled={busy} onClick={() => choose('handover')}>Choose markdown handover</Button>
      <span className="text-xs">Cost: you post the content yourself. No provider write.</span>
    </div>
  </section>;
}
