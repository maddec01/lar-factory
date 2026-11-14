import type { Item } from './item-domain.ts';

/** The same explanation follows a stale gate through manual, concept and automatic starts. */
export function staleGateReason(item: Pick<Item, 'staleGate' | 'staleGateDetail'>): string | null {
    if (item.staleGate && item.staleGateDetail) return item.staleGateDetail;

    if (item.staleGate === 'approval') return 'Gate out of date: approval is no longer current';

    return item.staleGate
        ? `Gate out of date: ${item.staleGate === 'brief' ? 'brief' : 'brief sources'} changed since approval`
        : null;
}
