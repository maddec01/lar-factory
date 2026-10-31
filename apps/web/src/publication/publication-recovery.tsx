import { useState } from 'react';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Field } from '../onboarding/setup-fields.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { usePublicationStore } from './publication-store.ts';

/** Recovery always inspects provider evidence before a user can resolve an uncertain write. */
export function PublicationRecovery() {
  const { state, busy, request } = usePublicationStore();
  const pending = state!.pending!;
  if (!pending.uncertain.length) return null;
  return <section className="grid min-w-0 gap-3" aria-label="Recover uncertain publication">
    <p className="m-0 text-sm">Inspect the provider outcome before deciding what to do. Publication will not retry an uncertain write.</p>
    <span><Button {...kind('other')} disabled={busy} onClick={() => void request('reconcile')}>Inspect uncertain outcomes</Button></span>
    {pending.plan.results.filter((result) => result.status === 'uncertain').map(({ operation }) => <UncertainOperation key={operation.operationId} operationId={operation.operationId} />)}
  </section>;
}

function UncertainOperation({ operationId }: { operationId: string }) {
  const { state, busy, request } = usePublicationStore();
  const [url, setUrl] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const candidate = state!.candidates?.find((item) => item.operationId === operationId);
  const operation = state!.pending!.plan.operations.find((item) => item.operationId === operationId)!;
  const ticket = state!.pending!.plan.tickets.find((item) => item.workId === operation.ticketWorkId)!;
  return <section className="grid min-w-0 gap-2" aria-label={`Resolve ${operation.kind} for ${ticket.title}`}>
    <h3 className="m-0 text-sm font-medium">{operation.kind} · {ticket.title}</h3>
    {candidate && <>
      <p className="m-0 text-sm">{candidate.evidence}</p>
      {candidate.tickets.map((item) => <div key={item.ticket} className="flex flex-wrap items-center gap-2">
        <a className="text-sm underline" href={item.url} target="_blank" rel="noopener">Inspect {item.ticket}</a>
        <Button {...kind('other')} disabled={busy} onClick={() => void request('reconcile', { selections: [{ operationId, ticket: item.ticket }] })}>Use inspected ticket {item.ticket}</Button>
      </div>)}
      {candidate.comments?.map((commentId) => <div key={commentId} className="grid gap-2">
        <p className="m-0 text-xs">Comment {commentId} matches this exact approved text.</p>
        {'content' in operation && <pre className="m-0 whitespace-pre-wrap break-words text-xs">{operation.content}</pre>}
        {ticket.destination.url && <a className="text-sm underline" href={ticket.destination.url} target="_blank" rel="noopener">Inspect comments on {ticket.destination.ticket}</a>}
        <span><Button {...kind('other')} disabled={busy} onClick={() => void request('reconcile', { selections: [{ operationId, commentId }] })}>Use inspected comment {commentId}</Button></span>
      </div>)}
    </>}
    {operation.kind === 'create' && <>
      <Field label={`Existing ticket URL for ${ticket.title}`} hint="Use this when search cannot find the ticket. The provider must confirm its exact approved content and team terms.">{(props) => <Input {...props} type="url" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />}</Field>
      <span><Button {...kind('other')} disabled={busy || !url.trim()} onClick={() => void request('reconcile-url', { operationId, url })}>Inspect and use existing URL</Button></span>
    </>}
    {candidate && <>
      <Field label="Your provider inspection evidence">{(props) => <Input {...props} value={evidence} disabled={busy} onChange={(e) => setEvidence(e.target.value)} />}</Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />I inspected the provider and confirm this write did not complete.</label>
      <span><Button {...kind('other')} disabled={busy || !confirmed || !evidence.trim()} onClick={() => void request('resolve-outcome', { operationId, evidence, didNotComplete: true })}>Record that this write did not complete</Button></span>
      <p className="m-0 text-xs">Cost: a mistaken resolution can cause a duplicate. A retry still requires a new preview and approval of the remaining write.</p>
    </>}
  </section>;
}
