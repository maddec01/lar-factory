import type { ItemSource } from '../items/item-source.ts';
import type { createFakeTracker } from './fake-tracker.ts';

/** The production item-source contract, backed solely by this sample instance. */
export function fakeItemSource(tracker: ReturnType<typeof createFakeTracker>, repo: string): ItemSource {
    const assertRepo = (requested: string) => {
        if (requested !== repo) throw new Error('This sample source belongs to a different fake repository.');
    };

    return {
        name: repo,
        // An Azure board source reads backlog items; their tasks show only as sub-tickets. A build's slices are never
        // board items, as GitHub's read drops them.
        read: async () => {
            const items = await tracker.list(repo);
            const slices = new Set(items.flatMap((item) => item.slices.map((s) => `${s.repo}#${s.number}`)));

            return {
                title: repo,
                items: items.filter(
                    (item) => item.azure?.type !== 'Task' && !slices.has(`${item.repo}#${item.number}`),
                ),
            };
        },
        searchTickets: (requested, query) => {
            assertRepo(requested);

            return tracker.search(repo, query);
        },
        readTicket: async (requested, number) => {
            assertRepo(requested);

            const issue = await tracker.read(repo, number);

            if (!issue || issue.item.state !== 'open') return null;

            return {
                number,
                title: issue.item.title,
                url: issue.item.url!,
                text: issue.details.body,
                kind: issue.item.kind,
                tracker: issue.item.tracker,
            };
        },
        observeTicket: async (requested, number) => {
            assertRepo(requested);

            const issue = await tracker.read(repo, number);

            return issue
                ? { state: issue.item.state, assignee: issue.details.assignees.sort().join(',') }
                : { state: 'not-found' };
        },
        abandon: async (item) => {
            assertRepo(item.repo);

            try {
                await tracker.edit(repo, item.number, { state: 'closed', closedAs: 'not-planned' });

                return null;
            } catch (error) {
                return (error as Error).message;
            }
        },
    };
}
