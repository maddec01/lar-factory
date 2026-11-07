// The provider reads that keep each work record's observations: its current PR's state, then its ticket's state and
// assignees. A change the record didn't make waits on the user through a Needs you cause and never moves the Status, except a
// merged PR, which finishes the work and makes it Done. A read that shows the change ended removes its cause. A failed
// read keeps the last observation and changes nothing.
// A decision or concept finishes from its record alone, once lar-work completion says it is complete.
// A record's Dependencies are read the same way, their tickets and PRs only, and what a read shows never marks one met
// or clears its mark.

import { sameRepo, type NeedsYouCause } from '@lar-factory/shared';
import {
    WorkRecordError,
    type DependencyObservationKind,
    type NewObservation,
    type Observation,
    type Observed,
    type PullRequestState,
    type WorkRecord,
    type WorkRecords,
} from '@lar-factory/work-records';

import { log } from '../log.ts';
import { AccessLost, NotFound, type TicketObservation } from './item-source.ts';
import { causesText, savedNeedsYou } from './needs-you-causes.ts';

/**
 * The provider reads an observation takes, each throwing when the provider can't answer: NotFound when it says the PR
 * doesn't exist, AccessLost when it refuses the signed-in account.
 */
export interface ObserveReads {
    ticket(repo: string, number: number): Promise<TicketObservation>;
    pr(repo: string, number: number): Promise<PullRequestState>;
    /** The ticket as the item source's last read showed it, which saves its read; undefined when that read didn't show it. */
    known?(repo: string, number: number): TicketObservation | undefined;
    /** Whether reads of `repo` wait for now, so a Dependency's ticket or PR there keeps its last observation. */
    waits?(repo: string): boolean;
    /** The kind the record and its ticket agree on in the last read, or null when they don't. */
    agreedKind?(record: WorkRecord): WorkRecord['kind'] | null;
    /** Hears that an observation alone moved the Dependency from revision `from` to `to`, and whether it `changed` the kind it shows. */
    observed?(dependencyId: string, from: number, to: number, changed: boolean): void;
}

/** How many records' provider reads run at once. */
const OBSERVED_AT_ONCE = 6;

/** The number in a reference, `owner/name#12`. */
const numberOf = (reference: string) => Number(reference.slice(reference.lastIndexOf('#') + 1));

/**
 * What the observation `next` makes of `causes`, given the record before it and the last one of its kind: a read that
 * shows a change raises its cause, and one that shows a cause ended removes it. A PR closing also raises a ticket last
 * read closed, as its notice may have gone with Keep working. A ticket closing raises only itself, because a closed PR
 * with no cause was resolved by a replacement build.
 */
function causesAfter(
    causes: readonly NeedsYouCause[],
    record: WorkRecord,
    previous: Observation | undefined,
    next: NewObservation,
    ticketClosed: boolean,
): NeedsYouCause[] {
    const was = previous?.state ?? null;
    const without = (...types: NeedsYouCause['type'][]) => causes.filter((cause) => !types.includes(cause.type));
    const raised = (cause: NeedsYouCause, kept: NeedsYouCause[]) =>
        kept.some((c) => c.type === cause.type) ? kept : [...kept, cause];

    if (next.of === 'pr') {
        if (next.state !== 'closed') return without('pr-closed');

        if (was === 'closed') return [...causes];

        const withPr = raised({ type: 'pr-closed' }, [...causes]);

        return ticketClosed ? raised({ type: 'ticket-closed' }, withPr) : withPr;
    }

    if (next.state === 'not-found') return raised({ type: 'ticket-missing' }, [...causes]);

    const done = record.status === 'Done' || record.finishedAt !== null;
    let kept = without('ticket-missing', ...(next.state === 'open' ? (['ticket-closed'] as const) : []));

    if (next.state === 'closed' && was !== 'closed' && !done) kept = raised({ type: 'ticket-closed' }, kept);

    const assignee = next.assignee ?? null;
    const moved = kept.find((cause) => cause.type === 'assignee-changed');

    if (was === null || was === 'not-found' || previous!.assignee === assignee || (done && !moved)) return kept;

    const from = moved ? moved.from : previous!.assignee;
    const others = kept.filter((cause) => cause !== moved);

    return from === assignee ? others : [...others, { type: 'assignee-changed', from, to: assignee }];
}

/** Reads the record's `of` and records what it shows, with what the change means for the work. */
async function observeOne(
    records: WorkRecords,
    workId: string,
    of: Observed,
    read: () => Promise<NewObservation>,
): Promise<void> {
    const previous = records.observations(workId).find((o) => o.of === of);
    const reference = of === 'ticket' ? records.read(workId).ticket : records.read(workId).pullRequest;
    let next: NewObservation;

    try {
        next = await read();
    } catch (err) {
        records.recordReadFailure(
            workId,
            records.read(workId).revision,
            of,
            err instanceof Error ? err.message : String(err),
        );

        return;
    }

    const before = records.read(workId);

    // A PR replaced during the read was not the one it read.
    if ((of === 'ticket' ? before.ticket : before.pullRequest) !== reference) return;

    // A slice is not on the board, so what a read shows on one stays free text.
    const slice = before.kind === 'slice';
    const observations = records.observations(workId);
    const saved = slice ? { causes: [], oldWording: false } : savedNeedsYou(before, observations);
    const causes = causesAfter(
        saved.causes,
        before,
        previous,
        next,
        observations.some((o) => o.of === 'ticket' && o.state === 'closed'),
    );
    let record = records.observe(workId, before.revision, next);

    if (next.of === 'pr' && next.state === 'merged' && record.status !== 'Done')
        record = records.update(workId, record.revision, { status: 'Done' });

    if (next.of === 'ticket' && next.state === 'not-found') record = records.setAside(workId, record.revision);

    if (slice) {
        if (causes.length) records.setNeedsYou(workId, record.revision, causesText(before, causes).join(' '));
    } else records.setNeedsYouCauses(workId, record.revision, causes, { clearReason: saved.oldWording });
}

/** Apply a current PR read through the same completion and Needs you rules as the idle observer. */
export async function observePullRequest(
    records: WorkRecords,
    workId: string,
    read: () => Promise<PullRequestState>,
): Promise<void> {
    await observeOne(records, workId, 'pr', async () => ({ of: 'pr', state: await read() }));
}

/** The kinds a ticket or PR read open again was last read as, which make it reopened. */
const ENDED: readonly (DependencyObservationKind | undefined)[] = ['closed', 'merged', 'reopened'];

/** Reads the Dependency's ticket or PR `subject` and records what it shows, beside the last read that answered when it fails. */
async function observeDependency(
    records: WorkRecords,
    dependencyId: string,
    subject: string,
    read: () => Promise<TicketObservation['state'] | PullRequestState>,
    observed: ObserveReads['observed'],
): Promise<void> {
    let kind: DependencyObservationKind;
    let detail: string | undefined;

    try {
        const state = await read();

        kind = state === 'not-found' ? 'deleted' : state;
    } catch (err) {
        kind = err instanceof NotFound ? 'deleted' : err instanceof AccessLost ? 'access-lost' : 'read-failed';
        detail = (err instanceof Error ? err.message : String(err)) || undefined;
    }

    const dependency = records.dependency(dependencyId);

    // A ticket or PR the Dependency stopped naming during the read was not one it reads.
    if (subject !== dependency.ticket && !dependency.pullRequests.includes(subject)) return;

    const last = dependency.observations.find((o) => o.subject === subject);

    if (kind === 'open' && ENDED.includes(last?.lastGood?.kind ?? last?.kind)) kind = 'reopened';

    const { revision } = records.observeDependency(dependencyId, dependency.revision, {
        subject,
        kind,
        ...(detail && { detail }),
    });
    // A failed read shows the last read that answered, so it changes nothing a mark decides on.
    const shown = last?.kind === 'read-failed' ? last.lastGood?.kind : last?.kind;

    observed?.(dependencyId, dependency.revision, revision, kind !== 'read-failed' && kind !== shown);
}

/** Keeps the kind a record and its ticket last agreed on, which later tells a disagreement's notice which side changed. */
function noteAgreement(records: WorkRecords, workId: string, reads: ObserveReads): void {
    const record = records.read(workId);
    const agreed = reads.agreedKind?.(record);

    if (agreed && agreed !== record.agreedTicketKind)
        records.update(workId, record.revision, { agreedTicketKind: agreed });
}

/**
 * Observes one record's current PR until the work finishes, then its ticket, PR first so a merge that closes the ticket
 * finishes the work before the ticket's close is seen. `changed` publishes each observation's writes.
 */
export async function observeWork(
    records: WorkRecords,
    { workId, repository, ticket, pullRequest, finishedAt }: WorkRecord,
    reads: ObserveReads,
    changed: () => void = () => {},
): Promise<void> {
    if (pullRequest && !finishedAt) {
        await observeOne(records, workId, 'pr', async () => ({
            of: 'pr',
            state: await reads.pr(repository, numberOf(pullRequest)),
        })).finally(changed);
    }

    if (ticket && !records.read(workId).setAside) {
        const number = numberOf(ticket);

        await observeOne(records, workId, 'ticket', async () => ({
            of: 'ticket',
            ...(reads.known?.(repository, number) ?? (await reads.ticket(repository, number))),
        })).finally(changed);
        noteAgreement(records, workId, reads);
    }
}

/**
 * Observes every active record of `repos`, less the work IDs in `hidden`, which retention hides: the record itself,
 * then its Dependencies' tickets and PRs, each once a pass, OBSERVED_AT_ONCE records at a time. `changed` publishes each observation's writes before another
 * provider read can hold up the pass. A record a thread changes meanwhile is read again next time.
 */
export async function observeRecords(
    records: WorkRecords,
    repos: readonly string[],
    reads: ObserveReads,
    hidden: ReadonlySet<string> = new Set(),
    changed: () => void = () => {},
): Promise<void> {
    const active = records
        .list({})
        .filter((r) => !r.setAside && !hidden.has(r.workId) && repos.some((repo) => sameRepo(repo, r.repository)));
    // Each Dependency ticket or PR reads once a pass, however many Dependencies name it.
    const subjectReads = new Map<string, Promise<TicketObservation['state'] | PullRequestState>>();
    const readSubject = (subject: string, ticket: boolean) => {
        const key = `${ticket ? 'ticket' : 'pr'}:${subject.toLowerCase()}`;

        if (!subjectReads.has(key)) {
            const repo = subject.slice(0, subject.lastIndexOf('#'));
            const number = numberOf(subject);

            subjectReads.set(
                key,
                ticket
                    ? (async () => (reads.known?.(repo, number) ?? (await reads.ticket(repo, number))).state)()
                    : reads.pr(repo, number),
            );
        }

        return subjectReads.get(key)!;
    };
    let next = 0;
    const observeNext = async (): Promise<void> => {
        for (; next < active.length;) await observeActive(active[next++]!);
    };
    const observeActive = async (record: WorkRecord): Promise<void> => {
        const { workId } = record;

        try {
            await observeWork(records, record, reads, changed);
            for (const { dependencyId, ticket: theirs, pullRequests } of records.dependencies(workId)) {
                for (const subject of [...(theirs ? [theirs] : []), ...pullRequests]) {
                    const repo = subject.slice(0, subject.lastIndexOf('#'));

                    if (reads.waits?.(repo)) continue;

                    await observeDependency(
                        records,
                        dependencyId,
                        subject,
                        () => readSubject(subject, subject === theirs),
                        reads.observed,
                    ).finally(changed);
                }
            }
        } catch (err) {
            if (err instanceof WorkRecordError && err.code === 'schema-too-new') throw err;

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

        if (!repos.some((repo) => sameRepo(repo, record.repository)) || !records.completion(record.workId).complete)
            continue;

        try {
            const done =
                record.status === 'Done' ? record : records.update(record.workId, record.revision, { status: 'Done' });

            records.recordFinished(record.workId, done.revision);
        } catch (err) {
            if (err instanceof WorkRecordError && err.code === 'schema-too-new') throw err;

            log(`can't finish ${record.workId}: ${(err as Error).message}`);
        }
    }
}
