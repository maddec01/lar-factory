import { createHash, randomUUID } from 'node:crypto';

import { briefScopeClaims, type BriefScope } from './brief-scope.ts';
import { contractReferences } from './contract-references.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { DecisionAnswers } from './decision-answers.ts';
import type { DependencyRecords } from './dependencies.ts';
import { storedRelease } from './release-records.ts';
import { cites, contractText } from './review-dependencies.ts';
import { storedScope } from './scope-records.ts';
import type { WorkRecord } from './work-records.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const text = (value: unknown): string =>
    typeof value === 'string' && value.trim()
        ? value
        : invalid('Doubt identity, evidence and ordering reasons must be nonempty text.');

/** Explicit ownership declarations avoid pretending to infer semantic conflicts from prose. */
export function namedWork(brief: string): { files: string[]; contracts: string[] } {
    const names = (label: string) =>
        [...brief.matchAll(new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, 'gmi'))].flatMap((match) =>
            [...match[1]!.matchAll(/`([^`]+)`/g)].map((token) => token[1]!),
        );

    return {
        files: [
            ...new Set((briefScopeClaims(brief).get('scope.files') ?? []).map((name) => name.replace(/^\.\//, ''))),
        ].sort(),
        contracts: [...new Set(names('Contracts'))].sort(),
    };
}

interface Overlap {
    otherWorkId: string;
    files: string[];
    contracts: string[];
    ordered: boolean;
    proposed: { workId: string; blockerId: string } | null;
}
export interface OrderingReason {
    otherWorkId: string;
    reason: string;
}
export interface DoubtReview {
    reviewId: string;
    dependencyVersion?: 1 | 2;
    packageDigest: string;
    identity: string;
    evidence: string;
    ordering: OrderingReason[];
    recordedAt: string;
}
interface ReviewSource {
    workId: string;
    title: string;
    request: string;
    repository: string;
    kind: string;
    parentId: string | null;
    bodies: { body: string; markdown: string; written: number }[];
    answer: ReturnType<DecisionAnswers['decisionAnswer']> | null;
    named: ReturnType<typeof namedWork>;
    confirmedScope: BriefScope | null;
    releasePlan: import('@lar-factory/shared').ReleasePlan | null;
    blockers: string[];
    dependencies: ReturnType<DependencyRecords['dependencies']>;
}
interface DoubtPackage {
    workId: string;
    brief: string;
    destination: string;
    releaseConstraints: string;
    releasePlan: import('@lar-factory/shared').ReleasePlan | null;
    concept: ReviewSource | null;
    decisions: ReviewSource[];
    siblings: ReviewSource[];
    overlapping: ReviewSource[];
    source: ReviewSource;
    blockers: ReviewSource[];
    dependencies: ReturnType<DependencyRecords['blockingDependencies']>;
    overlaps: Overlap[];
    packageDigest: string;
}
export interface BriefReviewRecords {
    doubtPackage(workId: string): DoubtPackage;
    recordDoubt(
        workId: string,
        packageDigest: string,
        identity: string,
        evidence: string,
        ordering: OrderingReason[],
    ): DoubtReview;
    currentDoubt(workId: string): DoubtReview | null;
}

export function briefReviewRecords(
    database: Database,
    read: (id: string) => WorkRecord,
    dependencies: DependencyRecords,
    complete: (id: string) => boolean,
    answers: DecisionAnswers,
): BriefReviewRecords {
    const { db } = database;
    const bodies = db.prepare('SELECT body, markdown, written FROM bodies WHERE work_id = ? ORDER BY body');
    const edges = db.prepare('SELECT blocker_id FROM blockers WHERE work_id = ? ORDER BY blocker_id');
    const source = (record: WorkRecord): ReviewSource => {
        const answer = record.kind === 'decision' ? answers.decisionAnswer(record.workId) : null;
        const content = bodies
            .all(record.workId)
            .filter((row) => !['answer', 'domain-drafts'].includes(String(row.body)) || answer?.current !== null)
            .map((row) => ({ body: String(row.body), markdown: String(row.markdown), written: Number(row.written) }));

        return {
            workId: record.workId,
            title: record.title,
            request: String(
                db
                    .prepare(
                        "SELECT coalesce((SELECT json_extract(state, '$.startingContext') FROM ticket_specs WHERE work_id = ?), initial_context) AS request FROM work_records WHERE work_id = ?",
                    )
                    .get(record.workId, record.workId)?.request ?? '',
            ),
            repository: record.repository,
            kind: record.kind,
            parentId: record.parentId,
            bodies: content,
            answer,
            releasePlan: storedRelease(database, record.workId),
            confirmedScope: storedScope(database, record.workId)?.scope ?? null,
            named: namedWork(content.find((body) => body.body === 'brief')?.markdown ?? ''),
            blockers: edges.all(record.workId).map((row) => String(row.blocker_id)),
            dependencies: dependencies.dependencies(record.workId),
        };
    };
    const ordered = (start: string, end: string): boolean => {
        const queue = [start],
            seen = new Set<string>();

        for (const id of queue) {
            if (seen.has(id)) continue;

            seen.add(id);
            for (const edge of edges.all(id)) {
                if (edge.blocker_id === end) return true;

                queue.push(String(edge.blocker_id));
            }
        }

        return false;
    };
    const buildPackage = (workId: string, legacy = false, overlapDependencies = false): DoubtPackage => {
        const sources = new Map<string, ReviewSource>();
        const sourceOf = (record: WorkRecord): ReviewSource => {
            const prior = sources.get(record.workId);

            if (prior) return prior;

            const value = source(record);

            sources.set(record.workId, value);

            return value;
        };
        const record = read(workId);
        const own = sourceOf(record);
        const brief = own.bodies.find((body) => body.body === 'brief')?.markdown;

        if (!brief?.trim()) invalid('Doubt needs a saved brief.');

        let root = record;

        while (root.parentId) root = read(root.parentId);

        const active = db
            .prepare("SELECT work_id FROM work_records WHERE set_aside_at IS NULL AND kind <> 'slice' ORDER BY work_id")
            .all()
            .map((row) => read(String(row.work_id)));
        const belongs = (candidate: WorkRecord) => {
            let owner = candidate;

            while (owner.parentId) owner = read(owner.parentId);

            return owner.workId === root.workId;
        };
        const related = active.filter((candidate) => candidate.workId !== workId && belongs(candidate));
        const overlaps: Overlap[] = [];
        const overlapping: ReviewSource[] = [];

        for (const candidate of active) {
            if (candidate.workId === workId || ['concept', 'decision'].includes(candidate.kind)) continue;

            // A linked-work parent describes the group, not an extra delivery changing its children's files.
            if (
                db
                    .prepare(
                        "SELECT 1 FROM work_records WHERE parent_id = ? AND kind <> 'slice' AND set_aside_at IS NULL",
                    )
                    .get(candidate.workId)
            )
                continue;

            const other = sourceOf(candidate);
            const files =
                own.repository.toLowerCase() === other.repository.toLowerCase()
                    ? own.named.files.filter((file) => other.named.files.includes(file))
                    : [];
            const contracts = own.named.contracts.filter((contract) => other.named.contracts.includes(contract));

            if (!files.length && !contracts.length) continue;

            overlapping.push(other);

            if (complete(candidate.workId)) continue;

            const hasOrder = ordered(workId, candidate.workId) || ordered(candidate.workId, workId);

            overlaps.push({
                otherWorkId: candidate.workId,
                files,
                contracts,
                ordered: hasOrder,
                proposed: hasOrder ? null : { workId, blockerId: candidate.workId },
            });
        }

        const map =
            root.kind === 'concept' ? (sourceOf(root).bodies.find((body) => body.body === 'map')?.markdown ?? '') : '';
        const section = (heading: string) =>
            map
                .split(/^##\s+/m)
                .find((part) => part.startsWith(`${heading}\n`))
                ?.slice(heading.length)
                .trim() ?? '';
        const content = {
            workId,
            brief: brief!,
            destination: section('Destination'),
            releaseConstraints: section('Release constraints'),
            releasePlan: storedRelease(database, root.workId),
            concept: root.kind === 'concept' ? sourceOf(root) : null,
            decisions: related.filter((item) => item.kind === 'decision').map(sourceOf),
            siblings: related.filter((item) => !['concept', 'decision'].includes(item.kind)).map(sourceOf),
            overlapping,
            source: own,
            blockers: own.blockers.map((id) => sourceOf(read(id))),
            dependencies: dependencies.blockingDependencies(workId),
            overlaps,
        };

        // Delivery progress changes the package's display, not its reviewed contracts.
        const dependencySpecs = (items: ReviewSource['dependencies']) =>
            items.map(({ dependencyId, need, owner, contract }) => ({ dependencyId, need, owner, contract }));
        const releaseSpec = (plan: import('@lar-factory/shared').ReleasePlan | null) =>
            plan && { steps: plan.steps.map(({ done: _, ...step }) => step), outcomeCheck: plan.outcomeCheck.what };
        const sourceSpec = (item: ReviewSource, own = false) => ({
            workId: item.workId,
            repository: item.repository,
            kind: item.kind,
            request: own ? item.request : undefined,
            brief: own ? brief : contractText(item.bodies.find((b) => b.body === 'brief')?.markdown ?? ''),
            confirmedScope: own ? item.confirmedScope : undefined,
            dependencies: own ? dependencySpecs(item.dependencies.filter((d) => d.blocks.includes(workId))) : undefined,
        });
        // Keep the broad package for semantic review, but approval depends only on named inputs.
        // Incorporation timestamps, map prose, unrelated answers and sibling Notes are not contracts.
        const referenced = (item: ReviewSource) => cites(brief!, item.workId, item.title);
        const consumed = contractReferences(
            brief!,
            [...content.siblings, ...content.overlapping, ...content.blockers].map((item) => ({
                workId: item.workId,
                title: item.title,
                brief: item.bodies.find((b) => b.body === 'brief')?.markdown ?? '',
            })),
            false,
        );
        const contracts = [
            ...new Map(
                [...content.siblings, ...content.overlapping, ...content.blockers]
                    .filter((item) =>
                        overlapDependencies
                            ? referenced(item) ||
                              own.named.contracts.some((name) => item.named.contracts.includes(name)) ||
                              content.overlaps.some((o) => o.otherWorkId === item.workId && o.files.length)
                            : consumed.includes(item.workId),
                    )
                    .map((item) => [item.workId, item]),
            ).values(),
        ].sort((a, b) => a.workId.localeCompare(b.workId));
        const reviewed = {
            workId,
            source: sourceSpec(own, true),
            decisions: content.decisions.filter(referenced).map((item) => ({
                workId: item.workId,
                answer: item.answer?.current?.text ?? item.answer?.replacement?.text ?? null,
            })),
            contracts: contracts.map((item) => sourceSpec(item)),
            blockers: overlapDependencies ? own.blockers : undefined,
            dependencies: dependencySpecs(content.dependencies),
            releaseContracts:
                content.releasePlan?.steps
                    .filter((step) => step.shipsWith?.includes(workId) || cites(brief!, step.id))
                    .map(({ done: _, ...step }) => step) ?? [],
        };

        const legacyDependencies = (items: ReviewSource['dependencies']) =>
            items.map((item) =>
                Object.fromEntries(
                    Object.entries(item).filter(
                        ([key]) =>
                            !['met', 'needsReview', 'observations', 'revision', 'createdAt', 'updatedAt'].includes(key),
                    ),
                ),
            );
        const legacySpec = (item: ReviewSource) => ({
            ...item,
            releasePlan: releaseSpec(item.releasePlan),
            dependencies: legacyDependencies(item.dependencies),
        });
        const old = legacy
            ? {
                  ...content,
                  releasePlan: releaseSpec(content.releasePlan),
                  concept: content.concept && legacySpec(content.concept),
                  source: legacySpec(content.source),
                  decisions: content.decisions.map(legacySpec),
                  siblings: content.siblings.map(legacySpec),
                  overlapping: content.overlapping.map(legacySpec),
                  blockers: content.blockers.map(legacySpec),
                  dependencies: legacyDependencies(content.dependencies),
                  overlaps: undefined,
              }
            : null;

        return { ...content, packageDigest: digest(legacy ? old : reviewed) };
    };
    const current = (workId: string): DoubtReview | null => {
        const row = db
            .prepare('SELECT content FROM doubt_reviews WHERE work_id = ? ORDER BY rowid DESC LIMIT 1')
            .get(workId);

        if (!row) return null;

        const review = JSON.parse(String(row.content)) as DoubtReview;

        return review.packageDigest === buildPackage(workId).packageDigest ? review : null;
    };

    // Rebind only reviews still proven current under the previous algorithm. Already stale evidence stays stale.
    const oldReviews = db
        .prepare('SELECT review_id,work_id,content FROM doubt_reviews')
        .all()
        .filter((row) => JSON.parse(String(row.content)).dependencyVersion !== 2);

    if (oldReviews.length)
        database.write(() => {
            for (const row of oldReviews) {
                const id = String(row.work_id);

                if (!bodies.all(id).some((b) => b.body === 'brief' && String(b.markdown).trim())) continue;

                const review = JSON.parse(String(row.content)) as DoubtReview;
                const current = buildPackage(id);

                if (
                    review.packageDigest !== current.packageDigest &&
                    review.packageDigest !== buildPackage(id, true).packageDigest &&
                    review.packageDigest !== buildPackage(id, false, true).packageDigest
                )
                    continue;

                db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
                    JSON.stringify({ ...review, dependencyVersion: 2, packageDigest: current.packageDigest }),
                    String(row.review_id),
                );
                db.prepare('UPDATE brief_gates SET review_digest=? WHERE work_id=? AND review_digest=?').run(
                    current.packageDigest,
                    id,
                    review.packageDigest,
                );
            }
        });

    return {
        doubtPackage: (id) => database.read(() => buildPackage(id)),
        currentDoubt: (id) => database.read(() => current(id)),
        recordDoubt: (id, packageDigest, identity, evidence, ordering) =>
            database.write(() => {
                const input = buildPackage(id);

                if (input.packageDigest !== packageDigest)
                    invalid('The Doubt package changed; rerun Doubt against the current package.');

                if (!Array.isArray(ordering)) invalid('Expected ordering reasons.');

                const checked = ordering.map((entry) => ({
                    otherWorkId: text(entry?.otherWorkId),
                    reason: text(entry?.reason),
                }));

                if (new Set(checked.map((entry) => entry.otherWorkId)).size !== checked.length)
                    invalid('Duplicate ordering reason.');

                for (const entry of checked)
                    if (
                        !input.overlaps.some((overlap) => overlap.otherWorkId === entry.otherWorkId && !overlap.ordered)
                    )
                        invalid('An ordering reason must name a current unordered overlap.');
                for (const overlap of input.overlaps)
                    if (!overlap.ordered && !checked.some((entry) => entry.otherWorkId === overlap.otherWorkId))
                        invalid(
                            `Record an ordering blocker for ${overlap.otherWorkId}, or explain why none is needed.`,
                        );

                const review = {
                    reviewId: randomUUID(),
                    dependencyVersion: 2 as const,
                    packageDigest,
                    identity: text(identity),
                    evidence: text(evidence),
                    ordering: checked,
                    recordedAt: new Date().toISOString(),
                };

                db.prepare('INSERT INTO doubt_reviews(review_id, work_id, content) VALUES (?, ?, ?)').run(
                    review.reviewId,
                    id,
                    JSON.stringify(review),
                );

                return review;
            }),
    };
}
