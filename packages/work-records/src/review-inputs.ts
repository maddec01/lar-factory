/** The product inputs retained with Doubt make later approval refusals explainable. */
export interface ProductInputs {
    brief: string;
    decisions: { workId: string; title: string; answer: string }[];
    contracts: { workId: string; title: string; text: string }[];
    other: string;
}

export function reviewChanges(before: ProductInputs | undefined, after: ProductInputs): string[] {
    if (!before) return ['Approval sources changed.'];

    const changes: string[] = [];

    if (before.brief !== after.brief) changes.push('Brief changed.');

    for (const id of new Set([...before.decisions, ...after.decisions].map((item) => item.workId))) {
        const old = before.decisions.find((item) => item.workId === id);
        const current = after.decisions.find((item) => item.workId === id);

        if (old?.answer !== current?.answer) changes.push(`Cited answer ${(current ?? old)!.title} changed.`);
    }
    for (const id of new Set([...before.contracts, ...after.contracts].map((item) => item.workId))) {
        const old = before.contracts.find((item) => item.workId === id);
        const current = after.contracts.find((item) => item.workId === id);

        if (old?.text !== current?.text) changes.push(`Contract ${(current ?? old)!.title} changed.`);
    }

    if (before.other !== after.other) changes.push('Confirmed scope, Dependency or release contract changed.');

    return changes;
}
