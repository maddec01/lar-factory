import type { PublicationLocation, PublicationOperation, PublicationTextConflict, PublicationTicket, PublishedText } from '@lar-factory/shared';
import { WorkRecordError } from './work-records.ts';
import { PublicationRefused, type PublicationProvider, type TicketReceipt } from './publication-providers.ts';

export type PublicationDelivery = 'body' | 'comment' | 'handover';
/** A user's explicit replacement boundary, against the complete freshly observed body or comment. */
export interface PublicationResolution {
  observedText: string;
  location: PublicationLocation;
  expectedText: string;
}
export class PublicationConflict extends WorkRecordError {
  readonly conflict: PublicationTextConflict;
  constructor(conflict: PublicationTextConflict) {
    super('invalid', `${conflict.reason} Resolve the text, reread and approve a new plan.`);
    this.conflict = conflict;
  }
}
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const section = (body: string, html: boolean) => html
  ? `\n<h2>Refined description</h2><pre>${escapeHtml(body)}</pre>\n<p>End of refined description</p>\n`
  : `\n\n<!-- refined-description -->\n## Refined description\n\n${body}\n\n<!-- /refined-description -->\n`;

/** Only unique exact stored text is located automatically. An edited or missing section always needs a resolution. */
export async function prepareText(provider: PublicationProvider, ticket: PublicationTicket, target: TicketReceipt, published: PublishedText | undefined,
  delivery: PublicationDelivery, operationId: string, resolution?: PublicationResolution): Promise<PublicationOperation[]> {
  if (delivery === 'handover') return [];
  const base = { operationId, ticketWorkId: ticket.workId, dependsOn: [] as string[] };
  if (delivery === 'comment') return [{ ...base, kind: 'comment', content: ticket.body }];
  const conflict = (current: string, proposed: string, reason: string): never => {
    throw new PublicationConflict({ workId: ticket.workId, stored: published?.text ?? '', current, proposed,
      location: published?.location ?? { kind: 'body', start: 0, end: 0 }, reason });
  };
  if (published?.location.kind === 'comment') {
    const location = published.location;
    const comments = await provider.findComments(ticket, target);
    const current = comments.find((c) => c.commentId === location.commentId)?.content;
    if (current === undefined) return conflict('', ticket.body, 'The published comment is missing. Choose a new comment or handover.');
    if (current !== published.text && (!resolution || resolution.location.kind !== 'comment' || resolution.location.commentId !== location.commentId
      || resolution.observedText !== current || resolution.expectedText !== current)) return conflict(current, ticket.body, 'A teammate changed the published comment.');
    return [{ ...base, kind: 'replace-comment', location, expectedText: current, content: ticket.body }];
  }
  const expected = await provider.readBody(ticket, target, resolution?.location.kind === 'body' ? resolution.location.field : published?.location.kind === 'body' ? published.location.field : undefined);
  if (expected.format === 'unsupported') throw new PublicationRefused('The raw description format cannot be preserved. Choose a comment or markdown handover.', ticket.body);
  // A created ticket's entire body is recorded without section delimiters; replace exactly that body on its first update.
  const bounded = published?.text.startsWith('\n\n<!-- refined-description -->') || published?.text.startsWith('\n<h2>Refined description</h2>');
  const content = published && !bounded && expected.format === 'markdown' && resolution?.expectedText !== ''
    ? ticket.body : section(ticket.body, expected.format === 'html');
  let location: Extract<PublicationLocation, { kind: 'body' }>;
  let expectedText = '';
  if (resolution) {
    if (resolution.location.kind !== 'body' || resolution.observedText !== expected.body) return conflict(expected.body, content, 'The provider changed after the resolution.');
    location = resolution.location; expectedText = resolution.expectedText;
    if (!Number.isSafeInteger(location.start) || !Number.isSafeInteger(location.end) || location.start < 0 || location.end < location.start
      || location.end > expected.body.length || location.end - location.start !== expectedText.length || expected.body.slice(location.start, location.end) !== expectedText) {
      return conflict(expected.body, content, 'The selected resolution does not match the fresh raw description.');
    }
  } else if (published) {
    if (bounded) {
      const opening = expected.format === 'html' ? '<h2>Refined description</h2>' : '<!-- refined-description -->';
      const closing = expected.format === 'html' ? '<p>End of refined description</p>' : '<!-- /refined-description -->';
      if (expected.body.split(opening).length !== 2 || expected.body.split(closing).length !== 2) return conflict(expected.body, content, 'The refined section boundaries are missing or ambiguous.');
    }
    const start = expected.body.indexOf(published.text);
    if (start < 0 || expected.body.indexOf(published.text, start + 1) >= 0) return conflict(expected.body, content, 'The published text is edited, missing or ambiguous.');
    location = { kind: 'body', start, end: start + published.text.length }; expectedText = published.text;
  } else {
    if (expected.body.includes('refined-description') || expected.body.includes('Refined description')) return conflict(expected.body, content, 'An unrecorded refined section already exists.');
    location = { kind: 'body', start: expected.body.length, end: expected.body.length };
  }
  location = { kind: 'body', start: location.start, end: location.end, ...(expected.field ? { field: expected.field } : {}) };
  const operation: PublicationOperation = { ...base, kind: expectedText ? 'replace' : 'append', content, location, expectedText, expected };
  const operations: PublicationOperation[] = [operation];
  if (expected.assigned || expected.linkedPullRequest) operations.push({ ...base, operationId: `notice:${operationId}`, kind: 'comment', purpose: 'notice',
    dependsOn: [operationId], content: 'Updated the refined description with the agreed outcome and completion checks.' });
  return operations;
}
