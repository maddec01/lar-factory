import type { BoardData, Item, ItemThread } from '@lar-factory/shared';

/** How long ago the sample's running part last acted, so its line reads as working rather than quiet. */
const RECENT_MS = 60_000;

/**
 * A concept part's running thread from the sample fixture, which the fake tracker's tickets don't carry: the part keeps
 * its thread at work, its tool running and its last action a minute before the board read it, so the work map and parts
 * list show live activity.
 */
export function samplePartThreads(fixture: BoardData) {
    const running = new Map(
        fixture.items.flatMap((item) =>
            item.parentId &&
            item.number &&
            Array.isArray(item.threads) &&
            item.threads.some((thread) => thread.state === 'running' && thread.activity?.available)
                ? [[`${item.repo}#${item.number}`, item.threads] as const]
                : [],
        ),
    );

    return {
        project(item: Item, now = Date.now()): Item {
            const threads = running.get(`${item.repo}#${item.number}`);

            if (!threads || (Array.isArray(item.threads) && item.threads.length)) return item;

            const at = new Date(now - RECENT_MS).toISOString();

            return {
                ...item,
                threads: threads.map((thread): ItemThread =>
                    thread.activity?.available
                        ? {
                              ...thread,
                              updated: at,
                              // Its tool stays running, so the line reads as working however long the sample runs.
                              activity: { ...thread.activity, actionAt: at, toolRunning: true },
                          }
                        : thread,
                ),
            };
        },
    };
}
