// What a work record's Needs you causes and free text mean on the board: the notice's text, its offers and, for a
// record saved before causes existed, the causes its old wording stands for.

import type { Item, NeedsYouCause, NeedsYouOffer } from '@lar-factory/shared';
import type { Observation, WorkRecord } from '@lar-factory/work-records';

export const NO_THREAD = "The board asked T3 for a thread, but T3 shows no thread for it. Check the repository's project in T3 Code.";

const named = (what: string, reference: string | null) => (reference ? `${what} ${reference}` : what);

/** What each cause says. Causes show in this order. */
const TEXT: { [Type in NeedsYouCause['type']]: (record: WorkRecord, cause: Extract<NeedsYouCause, { type: Type }>) => string } = {
  'pr-closed': (record) => `${named('Its PR', record.pullRequest)} closed without merging.`,
  'ticket-closed': (record) => `${named('Its ticket', record.ticket)} closed in its provider.`,
  'assignee-changed': (record, { from, to }) => `${named('Its ticket', record.ticket)} moved from ${from ?? 'no one'} to ${to ?? 'no one'}.`,
  'ticket-missing': (record) => `${named('Its ticket', record.ticket)} wasn't found in its provider, so the board set the work aside. Restore it from Settings › Archive once the ticket is back.`,
  'no-thread': () => NO_THREAD,
};
const ORDER = Object.keys(TEXT) as NeedsYouCause['type'][];

/** The sentences that name `causes`, in a fixed order whichever came first. */
export function causesText(record: WorkRecord, causes: readonly NeedsYouCause[]): string[] {
  const sorted = [...causes].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  return sorted.map((cause) => (TEXT[cause.type] as (record: WorkRecord, cause: NeedsYouCause) => string)(record, cause));
}

/** The offers of the first row `causes` match. */
function offersOf(causes: readonly NeedsYouCause[]): NeedsYouOffer[] {
  const has = (type: NeedsYouCause['type']) => causes.some((cause) => cause.type === type);
  if (has('pr-closed')) return ['reopen-pr', 'replace-pr', 'set-aside'];
  if (has('ticket-closed') || has('assignee-changed')) return ['keep-working', 'set-aside'];
  if (has('no-thread')) return ['start-again', 'set-aside'];
  return ['mark-handled', 'set-aside'];
}

/** The wordings records were saved with before causes, each with the cause it stands for; a reopened-on-Done reason stands for none. */
const OLD_WORDING: readonly [RegExp, (match: RegExpExecArray) => NeedsYouCause | null][] = [
  [/^Its PR .+ closed without merging\. Reopen it, start a replacement build from the same brief, or set the work aside\.$/, () => ({ type: 'pr-closed' })],
  [/^Its ticket .+ closed in its provider\. Set the work aside, or clear this to keep working\.$/, () => ({ type: 'ticket-closed' })],
  [/^Its ticket .+ reopened after the work was Done\. Reopen the work, or clear this\.$/, () => null],
  // Neither name group crosses " to ", so each has one match and the time stays linear in the reason's length.
  [/^Its ticket [^#]+#\d+ moved from ((?:(?! to ).)+) to ((?:(?! to ).)+)\. Check who owns the work, then clear this\.$/, ([, from, to]) => ({ type: 'assignee-changed',
    from: from === 'no one' ? null : from!, to: to === 'no one' ? null : to! })],
  [/^Its ticket .+ wasn't found in its provider, so the board set the work aside\. Restore it from Settings › Archive once the ticket is back\.$/, () => ({ type: 'ticket-missing' })],
  [/^The board asked T3 for a thread, but T3 shows no thread for it\. Check the repository's project in T3 Code, then clear Needs you to start again\.$/, () => ({ type: 'no-thread' })],
];

/** A reason longer than any old wording, which reads as free text without trying them. */
const LONGEST_OLD_WORDING = 500;

/** The causes a saved old wording stands for today: closures of the other kind count, and any cause its observation reads ended does not. */
function oldCauses(saved: NeedsYouCause | null, record: WorkRecord, observations: readonly Observation[]): NeedsYouCause[] {
  const pr = observations.find((o) => o.of === 'pr');
  const ticket = observations.find((o) => o.of === 'ticket');
  const causes: NeedsYouCause[] = saved ? [saved] : [];
  if (saved?.type === 'pr-closed' && ticket?.state === 'closed') causes.push({ type: 'ticket-closed' });
  // Ready work replaced its closed PR, which sets that Status.
  if (saved?.type === 'ticket-closed' && pr?.state === 'closed' && record.status !== 'Ready') causes.push({ type: 'pr-closed' });
  return causes.filter((cause) => {
    if (cause.type === 'pr-closed') return !pr || pr.state === 'closed';
    if (cause.type === 'ticket-closed') return !ticket || ticket.state === 'closed';
    if (cause.type === 'ticket-missing') return !ticket || ticket.state === 'not-found';
    if (cause.type === 'assignee-changed') return !ticket || ticket.assignee !== cause.from;
    return true;
  });
}

/** Why the record waits: its causes and other free text, and whether the free text is old wording those causes replace. */
export function savedNeedsYou(record: WorkRecord, observations: readonly Observation[]): { causes: NeedsYouCause[]; other: string | null; oldWording: boolean } {
  const { needsYou: text, needsYouCauses: causes } = record;
  if (!text || causes.length || text.length > LONGEST_OLD_WORDING) return { causes, other: text, oldWording: false };
  for (const [wording, cause] of OLD_WORDING) {
    const match = wording.exec(text);
    if (match) return { causes: oldCauses(cause(match), record, observations), other: null, oldWording: true };
  }
  return { causes, other: text, oldWording: false };
}

/** The notice of a record that waits on the user; undefined when it doesn't, as on Done work, whatever it saved. */
export function needsYouNotice(record: WorkRecord, observations: readonly Observation[]): Item['needsYou'] {
  if (record.status === 'Done') return undefined;
  const { causes, other } = savedNeedsYou(record, observations);
  if (!causes.length && !other) return undefined;
  return { reason: [...causesText(record, causes), ...other ? [other] : []].join(' '), offers: offersOf(causes), causes,
    ticketOpen: observations.find((o) => o.of === 'ticket')?.state === 'open' };
}
