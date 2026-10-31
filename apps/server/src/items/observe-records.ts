// The provider reads that keep each work record's observations: its current PR's state, then its ticket's state and
// assignees. A change the record didn't make waits on the user through Needs you and never moves the Status, except a
// merged PR, which finishes the work and makes it Done. A failed read keeps the last observation and changes nothing.
// A decision or concept finishes from its record alone, once lar-work completion says it is complete.

import { sameRepo } from '@lar-factory/shared';
import type { NewObservation, Observation, Observed, PullRequestState, WorkRecord, WorkRecords } from '@lar-factory/work-records';
import { log } from '../log.ts';
import type { TicketObservation } from './item-source.ts';

/** The provider reads an observation takes, each throwing when the provider can't answer. */
export interface ObserveReads {
  ticket(repo: string, number: number): Promise<TicketObservation>;
  pr(repo: string, number: number): Promise<PullRequestState>;
  /** The ticket as the item source's last read showed it, which saves its read; undefined when that read didn't show it. */
  known?(repo: string, number: number): TicketObservation | undefined;
}

/** How many records' provider reads run at once. */
const OBSERVED_AT_ONCE = 6;

/** The number in a reference, `owner/name#12`. */
const numberOf = (reference: string) => Number(reference.slice(reference.lastIndexOf('#') + 1));

/** Why the observation `next` waits on the user, given the record before it and the last one of its kind; null when nothing does. */
function needsYouOf(record: WorkRecord, previous: Observation | undefined, next: NewObservation): string | null {
  const was = previous?.state ?? null;
  if (next.of === 'pr') {
    return next.state === 'closed' && was !== 'closed'
      ? `Its PR ${record.pullRequest} closed without merging. Reopen it, start a replacement build from the same brief, or set the work aside.` : null;
  }
  const ticket = record.ticket!;
  if (next.state === 'not-found') {
    return `Its ticket ${ticket} wasn't found in its provider, so the board set the work aside. Run \`lar-work restore ${record.workId}\` to bring it back.`;
  }
  const done = record.status === 'Done' || record.finishedAt !== null;
  if (next.state === 'closed' && was !== 'closed' && !done) return `Its ticket ${ticket} closed in its provider. Set the work aside, or clear this to keep working.`;
  if (next.state === 'open' && was === 'closed' && record.status === 'Done') return `Its ticket ${ticket} reopened after the work was Done. Reopen the work, or clear this.`;
  const assignee = next.assignee ?? null;
  if (was !== null && was !== 'not-found' && previous!.assignee !== assignee) {
    return `Its ticket ${ticket} moved from ${previous!.assignee ?? 'no one'} to ${assignee ?? 'no one'}. Check who owns the work, then clear this.`;
  }
  return null;
}

/** Reads the record's `of` and records what it shows, with what the change means for the work. */
async function observeOne(records: WorkRecords, workId: string, of: Observed, read: () => Promise<NewObservation>): Promise<void> {
  const previous = records.observations(workId).find((o) => o.of === of);
  const reference = of === 'ticket' ? records.read(workId).ticket : records.read(workId).pullRequest;
  let next: NewObservation;
  try { next = await read(); }
  catch (err) {
    records.recordReadFailure(workId, records.read(workId).revision, of, err instanceof Error ? err.message : String(err));
    return;
  }
  const before = records.read(workId);
  // A PR replaced during the read was not the one it read.
  if ((of === 'ticket' ? before.ticket : before.pullRequest) !== reference) return;
  const reason = needsYouOf(before, previous, next);
  let record = records.observe(workId, before.revision, next);
  if (next.of === 'pr' && next.state === 'merged' && record.status !== 'Done') record = records.update(workId, record.revision, { status: 'Done' });
  if (next.of === 'ticket' && next.state === 'not-found') record = records.setAside(workId, record.revision);
  if (reason) records.setNeedsYou(workId, record.revision, reason);
}

/**
 * Observes every active record of `repos`: its current PR until the work finishes, then its ticket, PR first so a merge
 * that closes the ticket finishes the work before the ticket's close is seen, OBSERVED_AT_ONCE records at a time. A
 * record a thread changes meanwhile is read again next time.
 */
export async function observeRecords(records: WorkRecords, repos: readonly string[], reads: ObserveReads): Promise<void> {
  const active = records.list({}).filter((r) => !r.setAside && repos.some((repo) => sameRepo(repo, r.repository)));
  let next = 0;
  const observeNext = async (): Promise<void> => {
    for (; next < active.length;) await observeActive(active[next++]!);
  };
  const observeActive = async ({ workId, repository, ticket, pullRequest, finishedAt }: WorkRecord): Promise<void> => {
    try {
      if (pullRequest && !finishedAt) {
        await observeOne(records, workId, 'pr', async () => ({ of: 'pr', state: await reads.pr(repository, numberOf(pullRequest)) }));
      }
      if (ticket && !records.read(workId).setAside) {
        const number = numberOf(ticket);
        await observeOne(records, workId, 'ticket', async () => ({ of: 'ticket', ...reads.known?.(repository, number) ?? await reads.ticket(repository, number) }));
      }
    } catch (err) {
      log(`can't record what ${workId}'s provider shows: ${(err as Error).message}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(OBSERVED_AT_ONCE, active.length) }, observeNext));
}

/**
 * Finishes each active decision and concept of `repos` that lar-work completion says is complete, making it Done. A
 * build finishes only when its PR is observed merged, so its completion alone changes nothing here.
 */
export function finishCompleted(records: WorkRecords, repos: readonly string[]): void {
  for (const record of records.list({})) {
    if (record.setAside || record.finishedAt || (record.kind !== 'decision' && record.kind !== 'concept')) continue;
    if (!repos.some((repo) => sameRepo(repo, record.repository)) || !records.completion(record.workId).complete) continue;
    try {
      const done = record.status === 'Done' ? record : records.update(record.workId, record.revision, { status: 'Done' });
      records.recordFinished(record.workId, done.revision);
    } catch (err) {
      log(`can't finish ${record.workId}: ${(err as Error).message}`);
    }
  }
}
