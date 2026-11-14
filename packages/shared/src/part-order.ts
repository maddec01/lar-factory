/** Group display order survives status changes, approval renewal and repository-local Queue moves. */
export function comparePartOrder(
    a: { createdAt?: string; partOrder?: number; number?: number; id: string },
    b: { createdAt?: string; partOrder?: number; number?: number; id: string },
): number {
    return (
        (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
        (a.partOrder ?? Infinity) - (b.partOrder ?? Infinity) ||
        (a.number || Infinity) - (b.number || Infinity) ||
        a.id.localeCompare(b.id, undefined, { numeric: true })
    );
}
