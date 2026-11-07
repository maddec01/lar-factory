import type { Item } from '@lar-factory/shared';
import type { RecordedThread, WorkRecords } from '@lar-factory/work-records';

/** Derive the notice after T3 observations, so a live item thread always holds it back. It names what the work already waits on, and a closed PR keeps its own notice. */
export function deletedThreadNotice(
    records: WorkRecords,
    item: Item,
    recorded?: readonly RecordedThread[],
): Item['needsYou'] {
    // The item's threads and its recorded threads, which a refresh reads for every record at once, answer for most items, so only the rest read their record.
    if (
        !Array.isArray(item.threads) ||
        item.threads.some((t) => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)
    )
        return item.needsYou;
    const latest = (recorded ?? records.threads(item.id))
        .filter((t) => t.purpose === 'shape' || t.purpose === 'build')
        .at(-1);
    if (!latest?.deletedAt) return item.needsYou;
    const record = records.read(item.id);
    if (record.kind === 'slice' || !['Shaping', 'Needs you', 'In progress', 'Review'].includes(record.status))
        return item.needsYou;
    const causes = item.needsYou?.causes ?? [];
    if (causes.some((c) => c.type === 'pr-closed')) return item.needsYou;
    const observations = records.observations(item.id);
    const pr = observations.find((o) => o.of === 'pr')?.state;
    const ticketClosed = causes.some((c) => c.type === 'ticket-closed');
    return {
        reason: ['The latest work thread was deleted.', ...(item.needsYou ? [item.needsYou.reason] : [])].join(' '),
        deletedThread: true,
        startAgainPurpose: item.needsYou?.startAgainPurpose ?? (latest.purpose === 'build' ? 'build' : 'shape'),
        causes,
        ticketOpen: observations.find((o) => o.of === 'ticket')?.state === 'open',
        ...(item.needsYou?.hasOtherNote && { hasOtherNote: true }),
        offers: [
            ...(pr === 'open'
                ? (['start-again'] as const)
                : (['start-again', 'back-to-queue', 'back-to-list'] as const)),
            ...(ticketClosed ? (['set-aside'] as const) : []),
        ],
    };
}
