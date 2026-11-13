// The board's items: the work records of the onboarded repositories, each with its ticket's context when an item source
// read the ticket. The record owns Status, kind, title, structure, blockers, Dependencies and slices; the ticket adds its URL, labels,
// PRs and provider fields. Board grouping can also use tracker links without writing local ownership.
// Spec sync can update title and brief; it never moves, restructures or blocks work.

import { kindDisagreement, onAzure, parseConceptMap, refKey, sameRepo, ticketKindOf } from '@lar-factory/shared';
import type {
    Blocker,
    DependencyHold,
    EffectiveVocabulary,
    IssueRef,
    Item,
    LinkedPr,
    Slice,
    SliceProgress,
    SwapKind,
    TicketKindFacts,
} from '@lar-factory/shared';
import type { Dependency, WorkRecord, WorkRecords } from '@lar-factory/work-records';

import { workItemUrl } from '../azure/azure-items.ts';
import { prUrl } from '../config/pr-host.ts';
import { loopTrace } from '../startup/loop-trace.ts';
import { needsYouNotice } from './needs-you-causes.ts';

type RecordSetup = {
    repo: string;
    structureSync?: boolean;
    writeRefinedSpec?: boolean;
    vocabulary?: EffectiveVocabulary;
};

/** The number in a ticket reference, `owner/name#12`. */
const ticketNumber = (ticket: string | null): number =>
    ticket ? Number(ticket.slice(ticket.lastIndexOf('#') + 1)) : 0;

/** The page of a ticket or PR reference: a GitHub issue or PR, or an Azure DevOps work item or PR. */
function referenceUrl(reference: string, pr: boolean): string {
    const repo = reference.slice(0, reference.lastIndexOf('#'));
    const number = ticketNumber(reference);

    if (pr) return prUrl(repo, number);

    const [organization, project] = repo.split('/');

    return onAzure(repo) ? workItemUrl(organization!, project!, number) : `https://github.com/${repo}/issues/${number}`;
}

/** A Dependency as the blocker it is for each build it holds: open until the user marks it met, which no observation decides. */
function dependencyBlocker(d: Dependency): Blocker {
    const observation = d.observations.reduce<DependencyHold['observation']>(
        (latest, o) => (!latest || o.observedAt > latest.observedAt ? o : latest),
        null,
    );
    const named = [
        ...(d.ticket ? [{ reference: d.ticket, url: referenceUrl(d.ticket, false) }] : []),
        ...d.pullRequests.map((pr) => ({ reference: pr, url: referenceUrl(pr, true) })),
    ];
    const hold: DependencyHold = {
        dependencyId: d.dependencyId,
        revision: d.revision,
        owner: d.owner,
        need: d.need,
        ticket: d.ticket,
        named,
        evidence: d.evidence,
        met: d.met,
        needsReview: d.needsReview,
        observation,
    };

    return {
        number: ticketNumber(d.ticket),
        repo: d.ticket ? d.ticket.slice(0, d.ticket.lastIndexOf('#')) : d.owner,
        state: d.met ? 'closed' : 'open',
        title: d.need,
        dependency: hold,
    };
}

/**
 * The PRs Open PR and the item dialog link: the recorded PR first, as the one this work delivers, then the ticket's.
 * The ticket's read of the recorded PR is the richer one when it has it; otherwise the record's last observation gives its state.
 */
function linkedPrs(records: WorkRecords, record: WorkRecord, ticket: Item | undefined): LinkedPr[] {
    const fromTicket = ticket?.linkedPrs ?? [];

    if (!record.pullRequest) return fromTicket;

    const url = referenceUrl(record.pullRequest, true);
    const same = (pr: LinkedPr) => pr.url.toLowerCase() === url.toLowerCase();
    const observed = records.observations(record.workId).find((o) => o.of === 'pr')?.state as
        | LinkedPr['state']
        | undefined;
    const recorded = fromTicket.find(same) ?? {
        number: ticketNumber(record.pullRequest),
        url,
        state: observed ?? 'open',
        isDraft: false,
        checks: null,
        mergeState: 'checking',
        pipelineUnread: true,
    };

    return [recorded, ...fromTicket.filter((pr) => !same(pr))];
}

const isDone = (record: WorkRecord) => record.status === 'Done';
const state = (record: WorkRecord): 'open' | 'closed' => (isDone(record) ? 'closed' : 'open');

function sliceProgress(record: WorkRecord): SliceProgress {
    if (isDone(record) || record.finishedAt) return 'done';

    if (record.needsYou) return 'blocked';

    return 'waiting';
}

/** The ticket items an item source read, by their lowercase reference, `owner/name#12`, in each repository that lists them. */
export function ticketsByReference(tickets: readonly Item[]): Map<string, Item> {
    const byTicket = new Map<string, Item>();

    for (const ticket of tickets) {
        for (const repo of [ticket.repo, ...(ticket.untaggedFor ?? [])])
            byTicket.set(refKey(repo, ticket.number).toLowerCase(), ticket);
    }

    return byTicket;
}

/** What a read ticket says about its kind. */
const kindFacts = (ticket: Item): TicketKindFacts => ({
    labels: ticket.labels,
    type: ticket.issueType ?? ticket.azure?.type ?? null,
});

/** The kind `record` and its ticket agree on in the last read, or null when they don't, or that read didn't show the ticket. */
export function agreedKind(
    record: WorkRecord,
    byTicket: ReadonlyMap<string, Item>,
    vocabulary: EffectiveVocabulary | undefined,
): SwapKind | null {
    const ticket = record.ticket ? byTicket.get(record.ticket.toLowerCase()) : undefined;
    const said = ticket && vocabulary ? ticketKindOf(record.kind, kindFacts(ticket), vocabulary) : null;

    return said === record.kind ? said : null;
}

/** Maps records and their local completion facts to board items, alongside their latest ticket context. */
function itemMapper(records: WorkRecords, tickets: readonly Item[], setups: readonly RecordSetup[] = []) {
    const byTicket = ticketsByReference(tickets);
    const trackerState = records.trackerStates();
    const byReference = new Map(
        records.list({}).flatMap((record) => (record.ticket ? [[record.ticket.toLowerCase(), record] as const] : [])),
    );
    const completions = new Map<string, ReturnType<WorkRecords['completion']>>();
    const completionOf = (record: WorkRecord) => {
        let completion = completions.get(record.workId);

        if (!completion) {
            completion = records.completion(record.workId);
            completions.set(record.workId, completion);
        }

        return completion;
    };
    const ticketOf = (record: WorkRecord) => (record.ticket ? byTicket.get(record.ticket.toLowerCase()) : undefined);
    const ref = (record: WorkRecord): IssueRef => ({
        number: ticketNumber(record.ticket),
        title: record.title,
        url: ticketOf(record)?.url ?? '',
        repo: record.repository,
        state: state(record),
    });
    const toItem = (record: WorkRecord): Item => {
        const ticket = ticketOf(record);
        const attachment = records.publicationAttachment(record.workId);
        const parent = record.parentId
            ? records.read(record.parentId)
            : ticket?.parent
              ? byReference.get(refKey(ticket.parent.repo, ticket.parent.number).toLowerCase())
              : undefined;
        const children = records.children(record.workId).filter((c) => !c.setAside);
        // A blocker holds the work until its local facts complete it; its Status, its ticket closing and its thread ending never do.
        const blockers = records
            .blockers(record.workId)
            .map((b): Blocker => ({
                number: ticketNumber(b.ticket),
                repo: b.repository,
                state: completionOf(b).complete ? 'closed' : 'open',
                workId: b.workId,
                title: b.title,
            }))
            .concat(record.kind === 'build' ? records.blockingDependencies(record.workId).map(dependencyBlocker) : []);
        const slices = children
            .filter((c) => c.kind === 'slice')
            .map((c): Slice => ({ ...ref(c), progress: sliceProgress(c), workId: c.workId }));
        const work = children.filter((c) => c.kind !== 'slice');
        const mapBody = record.kind === 'concept' ? records.body(record.workId, 'map') : null;
        const map =
            mapBody !== null
                ? parseConceptMap(mapBody)
                : record.kind === 'concept'
                  ? (ticket?.map ?? parseConceptMap(''))
                  : ticket?.map;
        const group = record.kind === 'concept' || work.length > 0;
        const derivedStatus = group
            ? completionOf(record).complete
                ? 'Done'
                : record.status === 'Done'
                  ? 'In progress'
                  : record.status
            : record.status;
        const done = derivedStatus === 'Done' || (isDone(record) && !group);
        const sync = trackerState(record.workId);
        const spec =
            setups.find((setup) => sameRepo(setup.repo, record.repository))?.writeRefinedSpec === false
                ? null
                : records.specState(record.workId);
        const gate = records.gate(record.workId);
        const activeBuild = !!(record.buildBranch || record.buildPhase || record.pullRequest);
        const briefApproval =
            !done &&
            !gate.current &&
            !!records.body(record.workId, 'brief') &&
            ((activeBuild && gate.evidence.length > 0) ||
                /approve.*brief|brief.*approval/i.test(record.needsYou ?? ''));
        const vocabulary = setups.find((setup) => sameRepo(setup.repo, record.repository))?.vocabulary;
        const disagreement = ticket && vocabulary ? kindDisagreement(record, kindFacts(ticket), vocabulary) : null;
        const item: Item = {
            content: 'ticket',
            labels: [],
            linkedPrs: linkedPrs(records, record, ticket),
            ...(ticket && { labels: ticket.labels }),
            ...(ticket?.labelColors && { labelColors: ticket.labelColors }),
            ...(ticket?.azure && { azure: ticket.azure }),
            ...(ticket?.sourceOrder !== undefined && { sourceOrder: ticket.sourceOrder }),
            ...(ticket?.abandonRefusal && { abandonRefusal: ticket.abandonRefusal }),
            ...(ticket?.currentSprint && { currentSprint: ticket.currentSprint }),
            id: record.workId,
            recorded: true,
            buildPhase: record.buildPhase,
            verification: records.verification(record.workId),
            retro: records.retro(record.workId),
            completion: completionOf(record),
            releasePlan: records.releasePlan(record.workId),
            ...(record.kind === 'concept'
                ? {
                      refinement: records.refinement(record.workId),
                      conceptBuild: records.conceptBuildPlan(record.workId),
                  }
                : {}),
            ...(ticket?.tracker && { tracker: ticket.tracker }),
            ...(sync && { sync }),
            ...(disagreement && { kindDisagreement: disagreement }),
            ...(spec &&
                (spec.pending !== null || spec.error || spec.warning) && {
                    specSync: { pending: spec.pending !== null, error: spec.error, warning: spec.warning },
                }),
            revision: record.revision,
            passingBrief: gate.current,
            ...(briefApproval && {
                briefApproval: {
                    digest: records.displayGate(record.workId).approvalDigest,
                    reason: activeBuild
                        ? 'The brief changed during Build. Review and approve the new brief.'
                        : 'Review the complete brief before it becomes Ready.',
                },
            }),
            status: derivedStatus,
            statuses: done ? [] : [derivedStatus],
            kind: record.kind === 'slice' ? 'issue' : record.kind,
            flow:
                record.kind === 'concept' ||
                (record.kind !== 'slice' && !!parent) ||
                work.length > 0 ||
                ticket?.flow === 'linked'
                    ? 'linked'
                    : 'single',
            ...(record.kind === 'decision' ? { decisionMethod: record.decisionMethod ?? null } : {}),
            number: ticketNumber(record.ticket),
            title: record.title || ticket?.title || '',
            url: ticket?.url ?? attachment?.url ?? null,
            repo: record.repository,
            state: done ? 'closed' : group ? 'open' : state(record),
            closedAs: done ? 'done' : null,
            parent: parent ? ref(parent) : (ticket?.parent ?? null),
            parentId: parent?.workId ?? null,
            subIssues: { total: work.length, completed: work.filter((child) => completionOf(child).complete).length },
            blockers,
            updatedAt: [record.updatedAt, spec?.changedAt ?? ''].sort().at(-1)!,
            closedAt: done ? (record.finishedAt ?? record.updatedAt) : null,
            slices,
        };

        if (map) item.map = map;

        const needsYou = needsYouNotice(record, records.observations(record.workId), () =>
            records.launchIntents({ workId: record.workId }),
        );

        if (needsYou) item.needsYou = needsYou;

        return item;
    };

    return { ticketOf, toItem };
}

/** Whether the record is work the board lists: not a slice, in one of `repos`. */
const listed = (record: WorkRecord, repos: readonly string[]) =>
    record.kind !== 'slice' && repos.some((repo) => sameRepo(repo, record.repository));

/** The records `recordItems` shows, how it maps each, and the open tickets no record holds, which show in List. */
function boardRecords(
    records: WorkRecords,
    tickets: readonly Item[],
    repos: readonly string[],
    unread: readonly string[],
    hidden: ReadonlySet<string>,
    setups: readonly RecordSetup[],
) {
    const { ticketOf, toItem } = itemMapper(records, tickets, setups);
    const waits = (record: WorkRecord) =>
        record.ticket !== null && !ticketOf(record) && unread.some((repo) => sameRepo(repo, record.repository));
    const all = records.list({});
    const held = new Set(all.flatMap((record) => (record.ticket ? [record.ticket.toLowerCase()] : [])));
    const unpicked = tickets
        .filter(
            (ticket) =>
                repos.some((repo) => sameRepo(repo, ticket.repo)) &&
                ticket.state === 'open' &&
                !held.has(refKey(ticket.repo, ticket.number).toLowerCase()),
        )
        .map((ticket): Item => ({ ...ticket, recorded: false, status: 'List', statuses: [], slices: [] }));

    return {
        shown: all.filter((r) => !r.setAside && !hidden.has(r.workId) && listed(r, repos) && !waits(r)),
        toItem,
        unpicked,
    };
}

/**
 * Every board item from the records of `repos`, in the records' order, with the ticket items an item source read,
 * less set-aside work and the work IDs in `hidden`, which retention hides. In a repository of `unread`, whose source
 * hasn't read yet, a record with a ticket waits until its ticket is read.
 */
export function recordItems(
    records: WorkRecords,
    tickets: readonly Item[],
    repos: readonly string[],
    unread: readonly string[] = [],
    hidden: ReadonlySet<string> = new Set(),
    setups: readonly RecordSetup[] = [],
): Item[] {
    const { shown, toItem, unpicked } = boardRecords(records, tickets, repos, unread, hidden, setups);

    return [...shown.map(toItem), ...unpicked];
}

/** How many records one turn maps: each takes a dozen queries, about 0.15 ms on a 340-item board. */
const RECORDS_PER_TURN = 50;

/**
 * recordItems, mapping RECORDS_PER_TURN records a turn so the event loop turns between them, all in one snapshot of the
 * records: commits between the turns, as an observation pass writes, wait for the next read. `records` must be a
 * connection that writes nothing meanwhile.
 */
function recordItemsInTurns(
    records: WorkRecords,
    tickets: readonly Item[],
    repos: readonly string[],
    unread: readonly string[],
    hidden: ReadonlySet<string>,
    setups: readonly RecordSetup[],
    turn: () => Promise<void>,
): Promise<Item[]> {
    return records.snapshot(async () => {
        const { shown, toItem, unpicked } = loopTrace.span('records', () =>
            boardRecords(records, tickets, repos, unread, hidden, setups),
        );
        const items: Item[] = [];

        for (let at = 0; at < shown.length; at += RECORDS_PER_TURN) {
            await turn();
            items.push(...loopTrace.span('records', () => shown.slice(at, at + RECORDS_PER_TURN).map(toItem)));
        }

        return [...items, ...unpicked];
    });
}

/**
 * recordItemsInTurns on `records`, a connection of its own, which gives the last items again, in no turn, when no commit
 * landed since that read and it maps the same tickets and settings.
 */
export function recordItemsReader(records: WorkRecords) {
    let mapped: { from: unknown[]; items: Item[] } | null = null;

    return async (
        tickets: readonly Item[],
        repos: readonly string[],
        unread: readonly string[],
        hidden: ReadonlySet<string>,
        setups: readonly RecordSetup[],
        turn: () => Promise<void>,
    ): Promise<Item[]> => {
        // Marked before the snapshot starts, so a commit during the read only makes the next read map again.
        const from = [records.changes(), tickets, JSON.stringify([repos, unread, [...hidden], setups])];

        if (mapped?.from.every((input, i) => input === from[i])) return mapped.items;

        const items = await recordItemsInTurns(records, tickets, repos, unread, hidden, setups, turn);

        mapped = { from, items };

        return items;
    };
}

/** Archive's items: the set-aside work of `repos` and the work in `hidden`, in the records' order, each with its `archived` facts. */
export function archivedItems(
    records: WorkRecords,
    tickets: readonly Item[],
    repos: readonly string[],
    hidden: ReadonlySet<string>,
): Item[] {
    const { ticketOf, toItem } = itemMapper(records, tickets);

    return records
        .list({})
        .filter((r) => (r.setAside || hidden.has(r.workId)) && listed(r, repos))
        .map((record) => ({
            ...toItem(record),
            archived: {
                setAside: record.setAside,
                hidden: hidden.has(record.workId),
                ticketOpen: ticketOf(record)?.state === 'open',
            },
        }));
}
