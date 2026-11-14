import { validateBlockers } from './blocker-graph.ts';
import { groupContractReferences } from './contract-references.ts';
import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecord, WorkRecords } from './work-records.ts';

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};

/** Legacy free prose must first be normalized by its owner; never guess edges from semantic prose. */
function declaredBlockers(brief: string): string[] | null {
    const lines = [...brief.matchAll(/^\s*(?:-\s*)?Blocked by:\s*(.*)$/gim)];

    if (!lines.length) return null;

    if (lines.length !== 1) invalid('Use one Blocked by declaration per brief.');

    const value = lines[0]![1]!.trim();

    if (/^none\.?$/i.test(value)) return [];

    const ids = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

    if (!ids.length || value.replace(/`[^`]+`/g, '').replace(/[,\s]/g, ''))
        invalid('Blocked by must list backtick work IDs or none.');

    if (new Set(ids).size !== ids.length) invalid('Duplicate declared blocker.');

    return ids.sort();
}

export function groupMembers(records: WorkRecords, id: string, allowSingle = false): WorkRecord[] {
    const root = records.read(id);

    if (
        root.parentId ||
        (!allowSingle && root.kind !== 'concept' && !records.children(id).some((r) => r.kind !== 'slice'))
    )
        invalid('Use the owning concept or linked-work parent.');

    const visit = (parent: string): WorkRecord[] =>
        records
            .children(parent)
            .filter((r) => r.kind !== 'slice')
            .flatMap((r) => [r, ...visit(r.workId)]);

    return [root, ...visit(id)];
}

/** Map declarations supplement briefs: Blocker: `consumer ID` <- `prerequisite ID`. */
export function blockerDeclarations(records: WorkRecords, id: string) {
    const members = groupMembers(records, id, true).filter((r) => !r.setAside);
    const declarations = new Map<string, string[]>();

    for (const r of members) {
        const declared = declaredBlockers(records.body(r.workId, r.kind === 'decision' ? 'decision' : 'brief') ?? '');

        if (declared !== null)
            declarations.set(
                r.workId,
                declared
                    .map((ref) => {
                        const matches = records
                            .list({})
                            .filter((candidate) => candidate.workId === ref || candidate.title === ref);

                        if (matches.length !== 1)
                            invalid(`Blocker reference ${ref} must identify exactly one work record.`);

                        return matches[0]!.workId;
                    })
                    .sort(),
            );
    }

    const mapped = new Map<string, string[]>();

    for (const line of (records.body(id, 'map') ?? '')
        .split('\n')
        .filter((line) => /^\s*(?:-\s*)?Blocker:/i.test(line))) {
        const match = /^\s*(?:-\s*)?Blocker:\s*`([^`]+)`\s*<-\s*(?:`([^`]+)`|(none))\s*$/i.exec(line);

        if (!match) invalid('Use Blocker: backtick consumer ID <- backtick prerequisite ID, or none.');

        const [, workId, blockerId] = match!;

        if (!members.some((r) => r.workId === workId))
            invalid(`Map blocker target ${workId} is not active in this group.`);

        const prior = mapped.get(workId!);

        if (prior && (!blockerId || !prior.length)) invalid('Do not combine none with blocker edges.');

        if (blockerId && prior?.includes(blockerId)) invalid('Duplicate map blocker edge.');

        mapped.set(workId!, [...(prior ?? []), ...(blockerId ? [blockerId] : [])].sort());
    }
    for (const [workId, ids] of mapped) {
        if (declarations.has(workId) && JSON.stringify(declarations.get(workId)) !== JSON.stringify(ids))
            invalid(`Brief and map blocker declarations disagree for ${workId}.`);

        declarations.set(workId, ids);
    }

    const contracts = groupContractReferences(records, members);

    if (contracts.unresolved.length)
        invalid(
            `Normalize contract source declarations (Produces or No ordering needed): ${contracts.unresolved.map((r) => `${r.workId}: ${r.contract}`).join(', ')}.`,
        );

    for (const [workId, refs] of contracts.references) {
        if (refs.length) declarations.set(workId, [...new Set([...(declarations.get(workId) ?? []), ...refs])].sort());
    }
    for (const [workId, ids] of declarations)
        for (const blockerId of ids) {
            const r = records.read(blockerId);

            if (r.setAside || r.supersededBy) invalid(`Replace retired blocker ${blockerId} declared by ${workId}.`);
        }

    const route = (start: string, end: string, skip: string, seen = new Set<string>()): boolean => {
        if (seen.has(start)) return false;

        seen.add(start);

        return (declarations.get(start) ?? records.blockers(start).map((r) => r.workId)).some(
            (next) => `${start}:${next}` !== skip && (next === end || route(next, end, skip, seen)),
        );
    };

    for (const [workId, refs] of contracts.references)
        for (const ref of refs)
            if (route(workId, ref, `${workId}:${ref}`))
                declarations.set(
                    workId,
                    declarations.get(workId)!.filter((id) => id !== ref),
                );

    return declarations;
}

export function missingBlockerDeclarations(records: WorkRecords, id: string, declarations: Map<string, string[]>) {
    return groupMembers(records, id, true).filter(
        (r) =>
            !r.setAside &&
            !['concept', 'decision'].includes(r.kind) &&
            !records.children(r.workId).some((child) => child.kind !== 'slice') &&
            !declarations.has(r.workId),
    );
}

export function blockerDeclarationRecords(database: Database, get: () => WorkRecords) {
    return {
        syncBlockers: (id: string, revisions: Record<string, number>) =>
            database.write(() => {
                const records = get();
                const declarations = blockerDeclarations(records, id);
                const missing = missingBlockerDeclarations(records, id, declarations);

                if (missing.length)
                    invalid(
                        `Normalize brief/map blocker declarations for: ${missing.map((r) => r.workId).join(', ')}.`,
                    );

                const touched = new Set([id]);

                for (const [workId, ids] of declarations) {
                    touched.add(workId);
                    for (const b of [...records.blockers(workId).map((r) => r.workId), ...ids]) touched.add(b);
                }
                for (const workId of touched) expectRevision(records.read(workId), revisions?.[workId] as number);

                let changed = false;

                for (const [workId, ids] of declarations) {
                    const before = records
                        .blockers(workId)
                        .map((r) => r.workId)
                        .sort();

                    if (JSON.stringify(before) === JSON.stringify(ids)) continue;

                    const record = records.read(workId);

                    if (record.buildPhase || record.buildBranch || record.pullRequest)
                        invalid('Pause and re-gate active work before changing its blockers.');

                    changed = true;
                    database.db.prepare('DELETE FROM blockers WHERE work_id=?').run(workId);
                    for (const b of ids)
                        database.db.prepare('INSERT INTO blockers(work_id,blocker_id) VALUES (?,?)').run(workId, b);
                }
                validateBlockers(database.db);

                if (changed)
                    for (const workId of touched)
                        database.db
                            .prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?')
                            .run(new Date().toISOString(), workId);

                return [...declarations].map(([workId, blockerIds]) => ({ workId, blockerIds }));
            }),
    };
}
