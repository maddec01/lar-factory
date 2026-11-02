// The one path that changes an item's kind and swaps it on its ticket, for item details and lar-work. Each write adds or
// removes one name, from a fresh read, so running the same change again after a failure finishes it. The record takes the
// new kind only after the ticket has. Without access for a write it needs, only the record changes.
import { SWAP_KINDS, kindCanChange, kindDisagreement, kindSwapAccessProblem, kindTicketSwap, sameLabel, trackerCapabilities } from '@lar-factory/shared';
import type { Kind, KindDisagreement, KindTicketSwap, LabelChange, RepositorySetup, SwapKind, TicketKindFacts, TicketKinds, TrackerLabels } from '@lar-factory/shared';
import { ticketKinds, trackerLabels } from '@lar-factory/shared/tracker-labels';
import { WorkRecordError, type WorkRecord, type WorkRecords } from './work-records.ts';

export interface KindChangeDeps {
  /** The repository's local setup: its mappings, access and, on Azure, its team. */
  setup?: RepositorySetup | undefined;
  /** The tracker; tests stand in for it. */
  labels?: Pick<TrackerLabels, 'addToTicket' | 'removeFromTicket'>;
  kinds?: TicketKinds;
}

export interface KindChangeResult {
  record: WorkRecord;
  /** What changed, in the tracker's own words. After a failure, what changed before it. */
  line: string;
  /** Why the change stopped, with the record's kind as it was, or null once the record took the new kind. */
  error: string | null;
  /** The label writes the tracker took, for showing them before the next read reports them. */
  labelChanges: LabelChange[];
  /** The type the tracker took, for the same reason, or null when it took none. */
  ticketType: string | null;
}

/** A disagreement as the shared path would act on it, for lar-work to report before anyone answers. */
export interface KindCheck extends KindDisagreement {
  /** What the swap leaves alone and why, in the words the change's line uses. */
  note: string;
  /** Why this login can't make the swap, or null when it can. */
  accessProblem: string | null;
}

const KIND_NAMES: Record<SwapKind, string> = { bug: 'Bug', feature: 'Feature', improvement: 'Improvement' };

const ticketNumber = (ticket: string) => Number(ticket.slice(ticket.lastIndexOf('#') + 1));

/** What giving `ticket` the kind changes on it, less a type the team's backlog doesn't show, which `note` explains. */
async function plannedSwap(ticket: TicketKindFacts, kind: SwapKind, setup: RepositorySetup | undefined, boardTypes: TicketKinds['boardTypes']): Promise<{ swap: KindTicketSwap; note: string }> {
  const swap = kindTicketSwap(ticket, kind, setup?.vocabulary);
  if (!swap.type) return { swap, note: '' };
  const { to } = swap.type;
  const shown = await boardTypes(setup?.itemSource?.kind === 'azure-board' ? setup.itemSource.team : undefined);
  return shown && !shown.some((type) => sameLabel(type, to))
    ? { swap: { ...swap, type: null }, note: ` The type stays ${ticket.type}, because the team's backlog doesn't show ${to}.` }
    : { swap, note: '' };
}

const swapProblem = (repo: string, swap: KindTicketSwap, setup: RepositorySetup | undefined) =>
  kindSwapAccessProblem(repo, swap, setup?.access ?? {}, setup?.azureReadOnly === undefined ? {} : { azureReadOnly: setup.azureReadOnly });

/** The record's disagreement with a fresh read of its ticket, or null when the board would show none. It writes nothing. */
export async function checkKind(record: WorkRecord, { setup, kinds }: Pick<KindChangeDeps, 'setup' | 'kinds'>): Promise<KindCheck | null> {
  if (!record.ticket || !setup?.vocabulary) return null;
  const number = ticketNumber(record.ticket);
  const { read, boardTypes } = kinds ?? ticketKinds(record.repository);
  try {
    const ticket = await read(number);
    const disagreement = kindDisagreement(record, ticket, setup.vocabulary);
    if (!disagreement) return null;
    const { swap, note } = await plannedSwap(ticket, record.kind as SwapKind, setup, boardTypes);
    return { ...disagreement, swap, note, accessProblem: swapProblem(record.repository, swap, setup) };
  } catch (error) {
    throw new WorkRecordError('invalid', `Could not read #${number}. ${(error as Error).message}`);
  }
}

export async function changeKind(records: WorkRecords, workId: string, revision: number, kind: SwapKind, { setup, ...tracker }: KindChangeDeps): Promise<KindChangeResult> {
  if (!SWAP_KINDS.includes(kind)) throw new WorkRecordError('invalid', 'Choose Bug, Feature or Improvement.');
  const record = records.read(workId);
  if (!kindCanChange(record.kind as Kind)) throw new WorkRecordError('invalid', `A ${record.kind} has no kind to change.`);
  if (record.revision !== revision) throw new WorkRecordError('stale-revision', `The work record ${workId} is at revision ${record.revision}, not ${revision}; read it again and retry.`);
  const name = KIND_NAMES[kind];
  // A read or observation can bump the record while the tracker answers, so the writes below take its revision then.
  const itemOnly = (why: string): KindChangeResult => ({ record: records.update(workId, records.read(workId).revision, { kind }), line: `This item is now ${name}. ${why}`, error: null, labelChanges: [], ticketType: null });
  if (!record.ticket) return itemOnly('Local work has no ticket to change.');

  const repo = record.repository;
  const number = ticketNumber(record.ticket);
  const { noun } = trackerCapabilities(repo);
  const { addToTicket, removeFromTicket } = tracker.labels ?? trackerLabels(repo);
  const { read, setType, boardTypes } = tracker.kinds ?? ticketKinds(repo);
  const done: string[] = [];
  const labelChanges: LabelChange[] = [];
  const line = (note = '') => `${done.length ? `#${number}: ${done.join('; ')}.` : ''}${note}`;
  try {
    const ticket = await read(number);
    const { swap, note } = await plannedSwap(ticket, kind, setup, boardTypes);
    const problem = swapProblem(repo, swap, setup);
    if (problem) return itemOnly(`Its ticket stays as it is: ${problem}`);

    for (const label of swap.add) {
      await addToTicket(number, [label]);
      done.push(`added ${noun} ${label}`);
      labelChanges.push({ label, action: 'add' });
    }
    for (const label of swap.remove) {
      await removeFromTicket(number, [label]);
      done.push(`removed ${noun} ${label}`);
      labelChanges.push({ label, action: 'remove' });
    }
    if (swap.type) {
      await setType(number, swap.type.to);
      done.push(`type ${ticket.type ?? 'none'} to ${swap.type.to}`);
    }
    const swapped = records.update(workId, records.read(workId).revision, { kind, agreedTicketKind: kind });
    // A type this change leaves alone can still read as another kind. The user chose this update, so that doesn't ask again.
    const left = kindDisagreement(swapped, {
      labels: [...ticket.labels.filter((label) => !swap.remove.includes(label)), ...swap.add],
      type: swap.type?.to ?? ticket.type,
    }, setup?.vocabulary);
    return {
      record: left ? records.recordKindAnswer(workId, swapped.revision, { answer: 'update', ticketKind: left.ticketKind }) : swapped,
      line: done.length ? line(note) : `#${number}: nothing to change on the ticket.${note}`,
      error: null, labelChanges, ticketType: swap.type?.to ?? null,
    };
  } catch (error) {
    return { record: records.read(workId), line: line(), error: `Could not finish changing #${number} to ${name}. ${(error as Error).message}`, labelChanges, ticketType: null };
  }
}
