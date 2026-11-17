import { createHash, randomUUID } from 'node:crypto';

import { briefScopeClaims, type BriefScope } from './brief-scope.ts';
import { contractReferences } from './contract-references.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { DecisionAnswers } from './decision-answers.ts';
import type { DependencyRecords } from './dependencies.ts';
import { productContent } from './product-content.ts';
import { storedRelease } from './release-records.ts';
import { cites, contractText } from './review-dependencies.ts';
import { reviewChanges, type ProductInputs } from './review-inputs.ts';
import { storedScope } from './scope-records.ts';
import type { WorkRecord } from './work-records.ts';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const text = (value: unknown): string =>
    typeof value === 'string' && value.trim() ? value : invalid('Doubt identity and evidence must be nonempty text.');

/** Explicit ownership declarations avoid pretending to infer semantic conflicts from prose. Files only rebind older reviews. */
function namedWork(brief: string, files: boolean): { files?: string[]; contracts: string[] } {
    const names = (label: string) =>
        [...brief.matchAll(new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, 'gmi'))].flatMap((match) =>
            [...match[1]!.matchAll(/`([^`]+)`/g)].map((token) => token[1]!),
        );

    return {
        ...(files && {
            files: [
                ...new Set((briefScopeClaims(brief).get('scope.files') ?? []).map((name) => name.replace(/^\.\//, ''))),
            ].sort(),
        }),
        contracts: [...new Set(names('Contracts'))].sort(),
    };
}

export interface DoubtReview {
    reviewId: string;
    dependencyVersion?: 1 | 2 | 3 | 4;
    productInputs?: ProductInputs;
    packageDigest: string;
    identity: string;
    evidence: string;
    /** Reasons for leaving file overlaps unordered, recorded before version 4. */
    ordering?: { otherWorkId: string; reason: string }[];
    recordedAt: string;
}
/** How a review recorded before version 4 computed its package digest. */
interface Earlier {
    legacy?: boolean;
    overlapDependencies?: boolean;
    raw?: boolean;
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
    source: ReviewSource;
    blockers: ReviewSource[];
    dependencies: ReturnType<DependencyRecords['blockingDependencies']>;
    packageDigest: string;
}
export interface BriefReviewRecords {
    doubtPackage(workId: string): DoubtPackage;
    recordDoubt(workId: string, packageDigest: string, identity: string, evidence: string): DoubtReview;
    currentDoubt(workId: string): DoubtReview | null;
    doubtChanges(workId: string, reviewId?: string): string[];
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
    const source = (record: WorkRecord, earlier: boolean): ReviewSource => {
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
            confirmedScope: storedScope(database, record.workId, earlier)?.scope ?? null,
            named: namedWork(content.find((body) => body.body === 'brief')?.markdown ?? '', earlier),
            blockers: edges.all(record.workId).map((row) => String(row.blocker_id)),
            dependencies: dependencies.dependencies(record.workId),
        };
    };
    const buildPackage = (workId: string, earlier?: Earlier): DoubtPackage & { productInputs: ProductInputs } => {
        const { legacy = false, overlapDependencies = false, raw = false } = earlier ?? {};
        const sources = new Map<string, ReviewSource>();
        const sourceOf = (record: WorkRecord): ReviewSource => {
            const prior = sources.get(record.workId);

            if (prior) return prior;

            const value = source(record, !!earlier);

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
        // Before version 4, briefs naming the same files or contracts joined the package as overlapping items.
        const overlapping: ReviewSource[] = [];
        const fileOverlaps = new Set<string>();

        for (const candidate of earlier ? active : []) {
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
                    ? (own.named.files ?? []).filter((file) => other.named.files?.includes(file))
                    : [];
            const contracts = own.named.contracts.filter((contract) => other.named.contracts.includes(contract));

            if (!files.length && !contracts.length) continue;

            overlapping.push(other);

            if (files.length && !complete(candidate.workId)) fileOverlaps.add(candidate.workId);
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
            source: own,
            blockers: own.blockers.map((id) => sourceOf(read(id))),
            dependencies: dependencies.blockingDependencies(workId),
        };
        const candidates = [...content.siblings, ...overlapping, ...content.blockers];

        // Delivery progress changes the package's display, not its reviewed contracts.
        const dependencySpecs = (items: ReviewSource['dependencies']) =>
            items.map(({ dependencyId, need, owner, contract }) => ({ dependencyId, need, owner, contract }));
        const releaseSpec = (plan: import('@lar-factory/shared').ReleasePlan | null) =>
            plan && { steps: plan.steps.map(({ done: _, ...step }) => step), outcomeCheck: plan.outcomeCheck.what };
        const contract = (text: string) => (raw ? contractText(text) : productContent(contractText(text)));
        const sourceSpec = (item: ReviewSource, own = false) => ({
            workId: item.workId,
            repository: item.repository,
            kind: item.kind,
            request: own ? item.request : undefined,
            brief: own ? brief : contract(item.bodies.find((b) => b.body === 'brief')?.markdown ?? ''),
            confirmedScope: own ? item.confirmedScope : undefined,
            dependencies: own ? dependencySpecs(item.dependencies.filter((d) => d.blocks.includes(workId))) : undefined,
        });
        // Keep the broad package for semantic review, but approval depends only on named inputs.
        // Incorporation timestamps, map prose, unrelated answers and sibling Notes are not contracts.
        const referenced = (item: ReviewSource) => cites(brief!, item.workId, item.title);
        const consumed = contractReferences(
            brief!,
            candidates.map((item) => ({
                workId: item.workId,
                title: item.title,
                brief: item.bodies.find((b) => b.body === 'brief')?.markdown ?? '',
            })),
            false,
        );
        const contracts = [
            ...new Map(
                candidates
                    .filter((item) =>
                        overlapDependencies
                            ? referenced(item) ||
                              own.named.contracts.some((name) => item.named.contracts.includes(name)) ||
                              fileOverlaps.has(item.workId)
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
                answer: raw
                    ? (item.answer?.current?.text ?? item.answer?.replacement?.text ?? null)
                    : productContent(item.answer?.current?.text ?? item.answer?.replacement?.text ?? ''),
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
        // Version 1 digested the whole package, in this key order.
        const old = legacy
            ? {
                  workId,
                  brief,
                  destination: content.destination,
                  releaseConstraints: content.releaseConstraints,
                  releasePlan: releaseSpec(content.releasePlan),
                  concept: content.concept && legacySpec(content.concept),
                  decisions: content.decisions.map(legacySpec),
                  siblings: content.siblings.map(legacySpec),
                  overlapping: overlapping.map(legacySpec),
                  source: legacySpec(content.source),
                  blockers: content.blockers.map(legacySpec),
                  dependencies: legacyDependencies(content.dependencies),
              }
            : null;

        return {
            ...content,
            packageDigest: digest(legacy ? old : reviewed),
            productInputs: {
                brief: brief!,
                decisions: reviewed.decisions.map((item) => ({
                    ...item,
                    answer: item.answer ?? '',
                    title: read(item.workId).title,
                })),
                contracts: reviewed.contracts.map((item) => ({
                    workId: item.workId,
                    title: read(item.workId).title,
                    text: item.brief ?? '',
                })),
                other: digest({
                    scope: own.confirmedScope,
                    dependencies: reviewed.dependencies,
                    releaseContracts: reviewed.releaseContracts,
                }),
            },
        };
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
        .filter((row) => JSON.parse(String(row.content)).dependencyVersion !== 4);

    if (oldReviews.length)
        database.write(() => {
            for (const row of oldReviews) {
                const id = String(row.work_id);

                if (!bodies.all(id).some((b) => b.body === 'brief' && String(b.markdown).trim())) continue;

                const review = JSON.parse(String(row.content)) as DoubtReview;
                const current = buildPackage(id);

                if (
                    review.packageDigest !== current.packageDigest &&
                    ![{}, { legacy: true }, { overlapDependencies: true, raw: true }, { raw: true }].some(
                        (earlier) => review.packageDigest === buildPackage(id, earlier).packageDigest,
                    )
                ) {
                    // Checked once: its stale digest and inputs stay, so later opens skip it.
                    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
                        JSON.stringify({ ...review, dependencyVersion: 4 }),
                        String(row.review_id),
                    );
                    continue;
                }

                db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
                    JSON.stringify({
                        ...review,
                        dependencyVersion: 4,
                        packageDigest: current.packageDigest,
                        productInputs: current.productInputs,
                    }),
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
        doubtPackage: (id) =>
            database.read(() => {
                const { productInputs: _, ...input } = buildPackage(id);

                return input;
            }),
        currentDoubt: (id) => database.read(() => current(id)),
        doubtChanges: (id, reviewId) =>
            database.read(() => {
                const row = reviewId
                    ? db.prepare('SELECT content FROM doubt_reviews WHERE work_id=? AND review_id=?').get(id, reviewId)
                    : db
                          .prepare('SELECT content FROM doubt_reviews WHERE work_id=? ORDER BY rowid DESC LIMIT 1')
                          .get(id);

                return row
                    ? reviewChanges(
                          (JSON.parse(String(row.content)) as DoubtReview).productInputs,
                          buildPackage(id).productInputs,
                      )
                    : [];
            }),
        recordDoubt: (id, packageDigest, identity, evidence) =>
            database.write(() => {
                const input = buildPackage(id);

                if (input.packageDigest !== packageDigest)
                    invalid('The Doubt package changed; rerun Doubt against the current package.');

                const review = {
                    reviewId: randomUUID(),
                    dependencyVersion: 4 as const,
                    productInputs: input.productInputs,
                    packageDigest,
                    identity: text(identity),
                    evidence: text(evidence),
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
