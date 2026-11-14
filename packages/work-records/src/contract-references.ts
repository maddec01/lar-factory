import { cites } from './review-dependencies.ts';
import type { WorkRecord, WorkRecords } from './work-records.ts';

/** Contract ownership is explicit. A shared label alone cannot identify which build produces it. */
function contractDeclarations(brief: string, field: string): string[] {
    return [...brief.matchAll(new RegExp(`^\\s*(?:-\\s*)?${field}:\\s*(.+)$`, 'gmi'))].flatMap((match) =>
        [...match[1]!.matchAll(/`([^`]+)`/g)].map((token) => token[1]!),
    );
}

function noOrdering(brief: string, reference: string): boolean {
    return [...brief.matchAll(/^\s*(?:-\s*)?No ordering needed:\s*`([^`]+)`:\s*(\S.*)$/gim)].some(
        (match) => match[1] === reference && !!match[2]!.trim(),
    );
}

/** Only delivery sections and declared references participate; history and incidental prose do not. */
function deliveryText(brief: string): string {
    let include = false;

    return brief
        .split('\n')
        .filter((line) => {
            if (/^##\s/.test(line))
                include = /^##\s+(What|Done when|Scope|Notes(?: for the builder)?|Contracts)\s*$/i.test(line);

            return include && !/^\s*(?:-\s*)?(Blocked by|No ordering needed):/i.test(line);
        })
        .join('\n');
}

export function contractReferences(
    brief: string,
    candidates: { workId: string; title: string; brief: string }[],
    ordering = true,
) {
    const references = new Set<string>();
    const text = deliveryText(brief);
    const consumed = [...contractDeclarations(brief, 'Consumes'), ...contractDeclarations(brief, 'Parent contract')];
    const contracts = contractDeclarations(brief, 'Contracts').filter(
        (name) => !contractDeclarations(brief, 'Produces').includes(name),
    );

    for (const candidate of candidates) {
        const outputs = contractDeclarations(candidate.brief, 'Produces');

        if (
            cites(text, candidate.workId, candidate.title) ||
            consumed.some((ref) => ref === candidate.workId || ref === candidate.title) ||
            contracts.some((name) => outputs.includes(name) && (!ordering || !noOrdering(brief, name)))
        ) {
            if (!ordering || (!noOrdering(brief, candidate.workId) && !noOrdering(brief, candidate.title)))
                references.add(candidate.workId);
        }
    }

    return [...references].sort();
}

export function groupContractReferences(records: WorkRecords, members: WorkRecord[]) {
    const candidates = records
        .list({})
        .filter((r) => !r.setAside && r.kind === 'build')
        .map((r) => ({ workId: r.workId, title: r.title, brief: records.body(r.workId, 'brief') ?? '' }));
    const references = new Map<string, string[]>();
    const unresolved: { workId: string; contract: string; candidates: string[] }[] = [];

    for (const r of members.filter((r) => r.kind === 'build' && !r.setAside)) {
        const brief = records.body(r.workId, 'brief') ?? '';
        const others = candidates.filter((c) => c.workId !== r.workId);

        references.set(r.workId, contractReferences(brief, others));
        for (const ref of contractDeclarations(brief, 'Consumes'))
            if (!noOrdering(brief, ref) && others.filter((c) => c.workId === ref || c.title === ref).length !== 1)
                unresolved.push({ workId: r.workId, contract: `Consumes: ${ref}`, candidates: [] });
        for (const contract of contractDeclarations(brief, 'Contracts')) {
            if (noOrdering(brief, contract) || contractDeclarations(brief, 'Produces').includes(contract)) continue;

            const shared = others.filter((c) =>
                [...contractDeclarations(c.brief, 'Contracts'), ...contractDeclarations(c.brief, 'Produces')].includes(
                    contract,
                ),
            );

            if (shared.length && !shared.some((c) => contractDeclarations(c.brief, 'Produces').includes(contract)))
                unresolved.push({ workId: r.workId, contract, candidates: shared.map((c) => c.workId) });
        }
    }

    for (const [owner, refs] of mapContractReferences(
        records,
        records.mapHistory(members[0]!.workId).at(-1)?.text ?? '',
    )) {
        if (references.has(owner)) references.set(owner, [...new Set([...references.get(owner)!, ...refs])].sort());
    }

    return { references, unresolved };
}

/** Parts entries identify the consuming record, never a global free-prose relationship guess. */
export function mapContractReferences(records: WorkRecords, map: string): Map<string, string[]> {
    const references = new Map<string, string[]>();
    const candidates = records.list({}).filter((r) => !r.setAside && r.kind === 'build');
    const section = /^##\s+Parts\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(map)?.[1] ?? '';

    for (const entry of section.split(/\n(?=\s*[-*]\s)/)) {
        const owner = /^\s*[-*]\s+\[build:\s*([^\]]+)\]/.exec(entry)?.[1];

        if (!owner || !candidates.some((c) => c.workId === owner)) continue;

        const brief = records.body(owner, 'brief') ?? '';

        references.set(
            owner,
            candidates
                .filter(
                    (candidate) =>
                        candidate.workId !== owner &&
                        cites(entry, candidate.workId, candidate.title) &&
                        !noOrdering(brief, candidate.workId) &&
                        !noOrdering(brief, candidate.title),
                )
                .map((c) => c.workId)
                .sort(),
        );
    }

    return references;
}

export function blockerPath(records: WorkRecords, from: string, to: string): boolean {
    const queue = [from],
        seen = new Set<string>();

    for (const id of queue) {
        if (seen.has(id)) continue;

        seen.add(id);
        for (const b of records.blockers(id)) {
            if (b.workId === to) return true;

            queue.push(b.workId);
        }
    }

    return false;
}
