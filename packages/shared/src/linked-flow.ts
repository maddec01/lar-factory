import type { Item } from './model.ts';

const refKey = (repo: string, number: number) => `${repo}#${number}`.toLowerCase();

export function linkedFlow(kind: string, repos: readonly (string | null | undefined)[]): Item['flow'] {
    const distinct = new Set(repos.flatMap((repo) => (repo ? [repo.toLowerCase()] : [])));

    return kind === 'concept' || distinct.size > 1 ? 'linked' : 'single';
}

export function settleFlows(items: readonly Item[]): Item[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const byRef = new Map(items.flatMap((item) => (item.number ? [[refKey(item.repo, item.number), item]] : [])));
    const parts = new Map<Item, Item[]>();

    for (const item of items) {
        const head =
            (item.parentId ? byId.get(item.parentId) : undefined) ??
            (item.parent ? byRef.get(refKey(item.parent.repo, item.parent.number)) : undefined);

        if (head && head !== item) parts.set(head, [...(parts.get(head) ?? []), item]);
    }

    const linked = new Set<Item>();

    for (const [head, group] of parts) {
        const members = [head, ...group];

        if (
            members.some((member) => member.flow === 'linked') ||
            linkedFlow(
                head.kind,
                members.map((member) => member.repo),
            ) === 'linked'
        )
            for (const member of members) linked.add(member);
    }

    return items.map((item) => (linked.has(item) && item.flow !== 'linked' ? { ...item, flow: 'linked' } : item));
}
