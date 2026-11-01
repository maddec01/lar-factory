// The one path that changes an item's kind and swaps it on its ticket, for item details and lar-work. Each write adds or
// removes one name, from a fresh read, so running the same change again after a failure finishes it. The record takes the
// new kind only after the ticket has. Without access for a write it needs, only the record changes.
import { SWAP_KINDS, kindCanChange, kindDisagreement, kindSwapAccessProblem, kindTicketSwap, sameLabel, trackerCapabilities } from '@lar-factory/shared';
import type { Kind, LabelChange, RepositorySetup, SwapKind, TicketKinds, TrackerLabels } from '@lar-factory/shared';
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

const KIND_NAMES: Record<SwapKind, string> = { bug: 'Bug', feature: 'Feature', improvement: 'Improvement' };

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
  const number = Number(record.ticket.slice(record.ticket.lastIndexOf('#') + 1));
  const { noun } = trackerCapabilities(repo);
  const { addToTicket, removeFromTicket } = tracker.labels ?? trackerLabels(repo);
  const { read, setType, boardTypes } = tracker.kinds ?? ticketKinds(repo);
  const access = setup?.access ?? {};
  const safety = setup?.azureReadOnly === undefined ? {} : { azureReadOnly: setup.azureReadOnly };
  const done: string[] = [];
  const labelChanges: LabelChange[] = [];
  const line = (note = '') => `${done.length ? `#${number}: ${done.join('; ')}.` : ''}${note}`;
  try {
    const ticket = await read(number);
    const swap = kindTicketSwap(ticket, kind, setup?.vocabulary);
    let note = '';
    if (swap.type) {
      const { to } = swap.type;
      const shown = await boardTypes(setup?.itemSource?.kind === 'azure-board' ? setup.itemSource.team : undefined);
      if (shown && !shown.some((type) => sameLabel(type, to))) {
        note = ` The type stays ${ticket.type}, because the team's backlog doesn't show ${to}.`;
        swap.type = null;
      }
    }
    const problem = kindSwapAccessProblem(repo, swap, access, safety);
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
