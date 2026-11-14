import type { Item, ItemThread } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Disposable T3 approval display evidence; resolving it never sends an approval to T3. */
export function sampleApproval(records: WorkRecords) {
    let workId: string | undefined;
    let pending = false;

    return {
        project(item: Item): Item {
            if (item.id !== workId) return item;

            const thread: ItemThread = {
                id: 'sample-approval-thread',
                title: 'Shape sandbox greeting',
                purpose: 'shape',
                state: 'running',
                updated: new Date().toISOString(),
                ...(pending
                    ? {
                          childNeedsYou: true,
                          pendingRequest: {
                              id: 'sample-approval',
                              threadId: 'sample-approval-owner',
                              ownerTitle: 'Explore sandbox greeting',
                              kind: 'tool-approval',
                          },
                          questionSummary: 'Allow reading the sandbox fixture folder? Inspect the fake greeting page.',
                      }
                    : { currentRunning: true }),
            };

            return { ...item, threads: [thread] };
        },
        control(repository: string, change: unknown) {
            if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

            if (!['seed', 'resolve'].includes(String(change))) throw Error('Choose seed or resolve.');

            if (!workId) {
                if (change !== 'seed') throw Error('Seed the fake approval first.');

                workId = records.create({
                    repository,
                    title: 'Sample T3 tool approval',
                    kind: 'feature',
                    status: 'Shaping',
                }).workId;
            }

            pending = change === 'seed';

            return workId;
        },
    };
}
