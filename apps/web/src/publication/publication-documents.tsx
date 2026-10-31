import { Input } from '@lar-factory/ui/design-system/Input';
import { Textarea } from '@lar-factory/ui/design-system/Textarea';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RadioGroup } from '@lar-factory/ui/design-system/RadioGroup';
import { Choice, Field, Group } from '../onboarding/setup-fields.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { usePublicationStore } from './publication-store.ts';

/** The private source is reference material. The user supplies the team-language projection explicitly. */
export function PublicationDocuments() {
  const { state, documents, editDocument, busy, delivery, chooseDelivery, resolutions } = usePublicationStore();
  return <div className="grid gap-6" data-publication-documents>
    <p className="m-0 text-sm">Write the content your team should read. Include enough detail to implement and check each change. Leave private workflow notes out.</p>
    {documents.map((doc) => {
      const source = state!.sources.find((source) => source.workId === doc.workId)!;
      const update = (change: Partial<typeof doc>) => editDocument(doc.workId, change);
      return <section key={doc.workId} className="grid min-w-0 gap-3 rounded-lg border border-base-300 p-3" aria-label={`Content for ${source.title}`}>
        <h3 className="m-0 text-sm font-medium">{source.title} · {source.repository}</h3>
        <details><summary className="cursor-pointer text-sm">Private refinement for reference</summary><pre className="whitespace-pre-wrap break-words text-xs">{source.body}</pre></details>
        <Group legend={`Delivery for ${source.title}`}>
          <RadioGroup value={delivery[doc.workId] ?? 'body'} onValueChange={(value) => chooseDelivery(doc.workId, value as 'body' | 'comment' | 'handover')} aria-label={`Delivery for ${source.title}`}>
            <Choice value="body" title={source.ticket ? 'Update the recorded location' : 'Create a ticket'} disabled={busy}>
              Cost: {source.ticket ? 'changes only the selected refined text after exact approval.' : 'creates a team ticket after exact approval.'}
            </Choice>
            <Choice value="comment" title="New comment" disabled={busy || !source.ticket}>Cost: posts a separately approved comment on an existing ticket.</Choice>
            <Choice value="handover" title="Markdown handover" disabled={busy}>Cost: you post the content yourself. No provider writes or write permission required.</Choice>
          </RadioGroup>
        </Group>
        {resolutions[doc.workId] && <p className="m-0 text-xs">An explicit text resolution is selected. Preview will reread the provider and show the exact replacement before approval.</p>}
        {state!.pending?.plan.tickets.find((ticket) => ticket.workId === doc.workId) && <details><summary className="cursor-pointer text-sm">Previous team content for reference</summary><pre className="whitespace-pre-wrap break-words text-xs">{state!.pending!.plan.tickets.find((ticket) => ticket.workId === doc.workId)!.body}</pre></details>}
        <Field label="Ticket title">{(props) => <Input {...props} value={doc.title} disabled={busy} onChange={(e) => update({ title: e.target.value })} />}</Field>
        {(['outcome', 'change'] as const).map((key) => <Field key={key} label={key === 'outcome' ? source.kind === 'concept' ? 'Destination' : 'Outcome' : 'Change'}>
          {(props) => <Textarea {...props} value={doc[key]} disabled={busy} onChange={(e) => update({ [key]: e.target.value })} />}
        </Field>)}
        {([{ key: 'checks', label: 'Completion checks' }, { key: 'assumptions', label: 'Confirmed assumptions' }, { key: 'builderNotes', label: 'Implementation notes' }, { key: 'domainNotes', label: 'Domain notes' }, { key: 'relatedTickets', label: 'Related ticket URLs' }] as const).map(({ key, label }) =>
          <Field key={key} label={label} hint={key === 'checks' && source.kind !== 'concept' ? 'Required for builds. Write at least one observable completion check, one per line.' : 'One per line. Leave empty if none apply.'}>{(props) => <Textarea {...props} value={doc[key].join('\n')} disabled={busy}
            onChange={(e) => update({ [key]: e.target.value.split('\n') })} onBlur={() => update({ [key]: doc[key].map((value) => value.trim()).filter(Boolean) })} />}</Field>)}
        {doc.decisions.map((decision, index) => <div key={index} className="grid gap-2">
          <Field label={`Decision ${index + 1}`}>{(props) => <Textarea {...props} value={decision.decision} disabled={busy} onChange={(e) => update({ decisions: doc.decisions.map((d, i) => i === index ? { ...d, decision: e.target.value } : d) })} />}</Field>
          <Field label={`Reason ${index + 1}`}>{(props) => <Textarea {...props} value={decision.reason} disabled={busy} onChange={(e) => update({ decisions: doc.decisions.map((d, i) => i === index ? { ...d, reason: e.target.value } : d) })} />}</Field>
          <Button {...kind('other')} disabled={busy} onClick={() => update({ decisions: doc.decisions.filter((_, i) => i !== index) })}>Remove decision {index + 1}</Button>
        </div>)}
        <span><Button {...kind('other')} disabled={busy} onClick={() => update({ decisions: [...doc.decisions, { decision: '', reason: '' }] })}>Add decision and reason</Button></span>
      </section>;
    })}
  </div>;
}
