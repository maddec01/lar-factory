import type { Item } from '@lar-factory/shared';

export function canStopShaping(item: Item): boolean {
    return (
        !item.setAside &&
        ['Shaping', 'Needs you'].includes(item.status) &&
        Array.isArray(item.threads) &&
        item.threads.some(
            (thread) =>
                thread.purpose === 'shape' &&
                !thread.observedAt &&
                !thread.archived &&
                (thread.state === 'running' ||
                    thread.state === 'needs you' ||
                    thread.queued ||
                    thread.hasRunningChildren),
        )
    );
}
