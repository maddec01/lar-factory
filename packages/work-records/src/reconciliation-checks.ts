import { readTicketSpec } from '@lar-factory/shared';
import type { ReconcileItem } from '@lar-factory/shared/group-reconciliation';

import { staleAnswerQuotes } from './answer-quotes.ts';
import { blockerDeclarations, missingBlockerDeclarations } from './blocker-declarations.ts';
import { blockerPath, groupContractReferences } from './contract-references.ts';
import { fogChecks } from './fog-checks.ts';
import { projectionChecks } from './group-projections.ts';
import type { WorkRecord, WorkRecords } from './work-records.ts';

type Check = Omit<ReconcileItem, 'digest'>;
/** Mechanical holds are re-derived, never dismissed by a checklist acknowledgement. */
export function reconciliationChecks(records: WorkRecords, groupId: string): Check[] {
    const items: Check[] = [];
    const add = (kind: Check['kind'], key: string, workId: string, summary: string, changes: string[]) =>
        items.push({ kind, key, workId, summary, changes, requiresFix: true });
    const all = (id: string): WorkRecord[] =>
        records
            .children(id)
            .filter((r) => r.kind !== 'slice')
            .flatMap((r) => [r, ...all(r.workId)]);
    const members = all(groupId);

    const contracts = groupContractReferences(records, [records.read(groupId), ...members]);

    for (const ref of contracts.unresolved)
        add(
            'blocker',
            `contract-source:${ref.workId}:${ref.contract}`,
            ref.workId,
            `Unresolved contract source for ${ref.contract}; declare Produces on its producer or No ordering needed with a reason on the consuming brief.`,
            ref.candidates,
        );
    for (const [workId, refs] of contracts.references)
        for (const producer of refs)
            if (!blockerPath(records, workId, producer))
                add(
                    'blocker',
                    `contract-blocker:${workId}:${producer}`,
                    workId,
                    `Consumer cites ${records.read(producer).title}'s output without a blocker; run sync-blockers or record No ordering needed with a reason.`,
                    [producer],
                );
    for (const quote of staleAnswerQuotes(records, groupId))
        add(
            'map',
            `answer-quote:${quote.workId}:${quote.partId}`,
            quote.workId,
            `Current answer quote no longer appears in ${records.read(quote.partId).title}'s current brief; refresh the answer and retain history.`,
            quote.quotes,
        );

    try {
        const declarations = blockerDeclarations(records, groupId);

        for (const missing of missingBlockerDeclarations(records, groupId, declarations))
            add(
                'blocker',
                `blocker-declaration:${missing.workId}`,
                missing.workId,
                'Normalize legacy blocker prose to a brief or local map declaration before syncing edges.',
                [],
            );
        for (const [id, declared] of declarations) {
            const stored = records
                .blockers(id)
                .map((b) => b.workId)
                .sort();

            if (JSON.stringify(declared) !== JSON.stringify(stored))
                add(
                    'blocker',
                    `declared-blockers:${id}`,
                    id,
                    'Stored blockers differ from brief/map declarations; run sync-blockers.',
                    [JSON.stringify({ declared, stored })],
                );
        }
    } catch (error) {
        add('blocker', `declared-blockers:${groupId}`, groupId, (error as Error).message, []);
    }

    items.push(...projectionChecks(records, groupId), ...fogChecks(records, groupId));
    for (const request of records.partTicketRequests(groupId))
        if (!request.ticket)
            add(
                'ticket',
                `ticket-request:${request.workId}`,
                request.workId,
                'Requested ticket is pending; retry sync-part-tickets.',
                [request.requestId],
            );

    const route = (start: string, end: string, skip?: string): boolean => {
        const queue = [start],
            seen = new Set<string>();

        for (const id of queue) {
            if (seen.has(id)) continue;

            seen.add(id);
            for (const b of records.blockers(id)) {
                if (`${id}:${b.workId}` === skip) continue;

                if (b.workId === end) return true;

                queue.push(b.workId);
            }
        }

        return false;
    };
    const pairs = new Set<string>();

    for (const r of [records.read(groupId), ...members].filter((member) => !member.setAside)) {
        const id = r.workId;
        const gate = records.gate(id);

        if (id !== groupId && !['concept', 'decision', 'slice'].includes(r.kind)) {
            const brief = records.body(id, 'brief');
            const review = brief?.trim() ? records.currentDoubt(id) : null;

            if (!brief?.trim()) add('brief', `brief:${id}`, id, `${r.title}: write the missing brief.`, ['brief']);
            else {
                const input = records.doubtPackage(id);

                if (!review && !r.finishedAt)
                    add(
                        'brief',
                        `doubt:${id}`,
                        id,
                        `${r.title}: review current answers, sibling endpoints/fields and removed contracts in Doubt; repair the brief and rerun the review.`,
                        [input.packageDigest],
                    );

                for (const overlap of input.overlaps.filter(
                    (o) =>
                        !o.ordered &&
                        (o.files.length > 0 || !review?.ordering.some((o2) => o2.otherWorkId === o.otherWorkId)),
                )) {
                    const pair = [id, overlap.otherWorkId].sort().join(':');

                    if (pairs.has(pair)) continue;

                    pairs.add(pair);
                    add(
                        'overlap',
                        `overlap:${pair}`,
                        id,
                        `${r.title}: record ordering with ${records.read(overlap.otherWorkId).title}, or a current Doubt explanation.`,
                        [...overlap.files, ...overlap.contracts],
                    );
                }
            }

            if (
                (!gate.current || !review || gate.passing?.reviewDigest !== review.packageDigest) &&
                gate.evidence.some((e) => ['gate', 'user'].includes(e.source ?? 'gate')) &&
                !r.finishedAt
            )
                add(
                    'gate',
                    `gate:${id}`,
                    id,
                    `${r.title}: approved gate is stale; rerun Doubt and request approval on the board.`,
                    [
                        gate.briefDigest ?? '',
                        records.body(id, 'brief') ? records.doubtPackage(id).packageDigest : 'missing brief',
                    ],
                );
        }

        if (r.ticket) {
            const spec = records.specState(id);

            if (spec.held || spec.error || spec.pending !== null || (spec.active && !gate.current))
                add(
                    'ticket',
                    `ticket:${id}`,
                    id,
                    `${r.title}: ${spec.held ? 'resolve held ticket edit' : (spec.error ?? (spec.pending !== null ? 'approved Spec write is pending' : 'Out-of-date Spec; retain it until the new gate is approved'))}.`,
                    [JSON.stringify(spec)],
                );

            if (
                spec.base &&
                (spec.base.title !== r.title ||
                    (gate.current && spec.active && readTicketSpec(spec.base.body).spec !== records.body(id, 'brief')))
            )
                add(
                    'ticket',
                    `projection:${id}`,
                    id,
                    `${r.title}: ticket title or Spec differs from the record; sync the approved projection.`,
                    [spec.base.digest, r.title, gate.briefDigest ?? ''],
                );
        }

        if (r.kind === 'decision' && records.decisionAnswer(id).current && !records.completion(id).complete)
            add(
                'map',
                `incorporate:${id}`,
                id,
                `${r.title}: incorporate the current answer and domain drafts into the map.`,
                records.completion(id).reasons,
            );

        for (const blocker of records.blockers(id)) {
            const key = `${id}:${blocker.workId}`;

            if (route(id, blocker.workId, key))
                add(
                    'blocker',
                    `redundant:${key}`,
                    id,
                    `${r.title}: remove redundant blocker on ${blocker.title}; another recorded path already orders it.`,
                    [key],
                );
        }
        for (const d of records.dependencies(id))
            if (d.needsReview)
                add(
                    'dependency',
                    `dependency-review:${d.dependencyId}`,
                    id,
                    `${d.need}: review changed Dependency evidence.`,
                    [String(d.revision)],
                );
    }
    for (const step of records.releaseSteps(groupId)) {
        const invalid = step.workIds.filter((id) => !members.some((r) => r.workId === id && !r.setAside));

        if (invalid.length)
            add(
                'release',
                `release-members:${step.id}`,
                groupId,
                `${step.title}: replace removed or set-aside release members.`,
                invalid,
            );
        else if (!step.evidence && step.workIds.length && step.workIds.every((id) => records.read(id).finishedAt))
            add(
                'release',
                `release-evidence:${step.id}`,
                groupId,
                `${step.title}: PRs merged; record release evidence${step.kind === 'ships-with' ? ' that these parts shipped together' : ''}.`,
                step.workIds,
            );
    }

    if (records.outcomeCheck(groupId).ready)
        add(
            'release',
            `outcome:${groupId}`,
            groupId,
            'Delivery and release are complete; the Outcome check still needs evidence. Run the owner check or record its result on the board.',
            [],
        );

    return items;
}
