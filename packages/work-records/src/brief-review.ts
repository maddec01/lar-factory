import { createHash, randomUUID } from 'node:crypto';

import { briefScopeClaims, type BriefScope } from './brief-scope.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { DecisionAnswers } from './decision-answers.ts';
import type { DependencyRecords } from './dependencies.ts';
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
    packageDigest: string;
    identity: string;
    evidence: string;
    ordering: OrderingReason[];
    recordedAt: string;
}
interface ReviewSource {
    workId: string;
    title: string;
    repository: string;
    kind: string;
    parentId: string | null;
    bodies: { body: string; markdown: string; written: number }[];
    answer: ReturnType<DecisionAnswers['decisionAnswer']> | null;
    named: ReturnType<typeof namedWork>;
    confirmedScope: BriefScope | null;
    blockers: string[];
    dependencies: ReturnType<DependencyRecords['dependencies']>;
}
interface DoubtPackage {
    workId: string;
    brief: string;
    destination: string;
    releaseConstraints: string;
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
            repository: record.repository,
            kind: record.kind,
            parentId: record.parentId,
            bodies: content,
            answer,
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
    const buildPackage = (workId: string): DoubtPackage => {
        const record = read(workId);
        const own = source(record);
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

            const other = source(candidate);
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
            root.kind === 'concept' ? (source(root).bodies.find((body) => body.body === 'map')?.markdown ?? '') : '';
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
            concept: root.kind === 'concept' ? source(root) : null,
            decisions: related.filter((item) => item.kind === 'decision').map(source),
            siblings: related.filter((item) => !['concept', 'decision'].includes(item.kind)).map(source),
            overlapping,
            source: own,
            blockers: own.blockers.map((id) => source(read(id))),
            dependencies: dependencies.blockingDependencies(workId),
            overlaps,
        };

        // Delivery progress changes the package's display, not its reviewed contracts.
        const dependencySpecs = (items: ReviewSource['dependencies']) =>
            items.map((item) =>
                Object.fromEntries(
                    Object.entries(item).filter(
                        ([key]) =>
                            !['met', 'needsReview', 'observations', 'revision', 'createdAt', 'updatedAt'].includes(key),
                    ),
                ),
            );
        const sourceSpec = (item: ReviewSource) => ({ ...item, dependencies: dependencySpecs(item.dependencies) });
        const reviewed = {
            ...content,
            concept: content.concept && sourceSpec(content.concept),
            source: sourceSpec(content.source),
            decisions: content.decisions.map(sourceSpec),
            siblings: content.siblings.map(sourceSpec),
            overlapping: content.overlapping.map(sourceSpec),
            blockers: content.blockers.map(sourceSpec),
            dependencies: dependencySpecs(content.dependencies),
            overlaps: undefined,
        };

        return { ...content, packageDigest: digest(reviewed) };
    };
    const current = (workId: string): DoubtReview | null => {
        const row = db
            .prepare('SELECT content FROM doubt_reviews WHERE work_id = ? ORDER BY rowid DESC LIMIT 1')
            .get(workId);

        if (!row) return null;

        const review = JSON.parse(String(row.content)) as DoubtReview;

        return review.packageDigest === buildPackage(workId).packageDigest ? review : null;
    };

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
