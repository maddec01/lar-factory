import type { BoardData, IssueRef, ItemDetails } from '@lar-factory/shared';

import detailFixture from '../../../../packages/shared/test/sample-details.json' with { type: 'json' };
import bundledBoard from '../../../../packages/shared/test/sample.json' with { type: 'json' };
import { FAKE_OWNER, emptyDetails, newFakeIssue, type FakeRepository } from './fake-tracker-state.ts';
import { sampleFixture } from './sample-fixture.ts';

/** The sample board's fixture (`BOARD_DATA_FILE`, with its scenarios), or the bundled one for tests. */
const boardFixture = (sampleFixture() ?? bundledBoard) as typeof bundledBoard;

/** A fixture repository's fake key: its owner swapped, the rest kept, so an Azure DevOps `org/project/repo` stays one. */
export const fakeRepo = (repo: string) => `${FAKE_OWNER}/${repo.split('/').slice(1).join('/')}`;

/** Remap every repository reference, including Markdown links; fixture source files remain unchanged. */
function remap<T>(value: T): T {
    let text = JSON.stringify(value);

    for (const { repo } of boardFixture.repos) text = text.replaceAll(repo, fakeRepo(repo));

    return JSON.parse(text) as T;
}

/** No filesystem, configuration or provider adapters are loaded; only the two bundled JSON fixtures. */
export function seedFakeTracker(): Map<string, FakeRepository> {
    const board = remap(boardFixture) as unknown as BoardData;
    const details = remap(detailFixture) as unknown as Record<string, ItemDetails>;
    const repositories = new Map<string, FakeRepository>();

    for (const config of board.repos) {
        const { repo, role, labels, items, team, setup } = config;

        repositories.set(repo, {
            config: { repo, role, labels, items, ...(team && { team }), setup },
            labels: [],
            issues: new Map(),
            creates: new Map(),
            nextNumber: 1,
        });
    }

    for (const item of board.items) {
        // Ticketless local work has no ticket to hold; the sample shows it from the fixture as its records would.
        if (!item.number) continue;

        const repository = repositories.get(item.repo)!;
        const issue = newFakeIssue(item.repo, item.number, { title: item.title, body: '', kind: item.kind });

        // PR/check/thread fixtures describe layout, never actual delivery from this tracker.
        issue.item = { ...item, linkedPrs: [], threads: [], stats: undefined, buildPhase: undefined };

        // A recorded item's record owns its parent and blockers, which may be ticketless; its ticket links none.
        if (item.recorded) Object.assign(issue.item, { parentId: null, blockers: [] });

        issue.details = details[item.id] ?? emptyDetails();
        issue.type = item.issueType ?? null;
        repository.issues.set(item.number, issue);
    }

    // A fixture's child/slice/blocker may be visible only in details. It must still be readable and writable.
    const addReference = (reference: IssueRef, parentId?: string) => {
        const repository = repositories.get(reference.repo);

        if (!repository || !reference.number || repository.issues.has(reference.number)) return;

        const issue = newFakeIssue(reference.repo, reference.number, {
            title: reference.title,
            body: '',
            kind: 'issue',
        });

        // An Azure DevOps child keeps its page and work item fields; the item source never lists its tasks.
        if (reference.url) issue.item.url = reference.url;

        if (reference.azure) issue.item.azure = reference.azure;

        issue.item.state = reference.state;
        issue.item.closedAs = reference.state === 'closed' ? 'done' : null;
        issue.item.parentId = parentId ?? null;
        repository.issues.set(reference.number, issue);
    };

    for (const item of board.items) {
        if (item.parent) addReference(item.parent);

        for (const blocker of details[item.id]?.blockers ?? []) addReference(blocker);

        for (const child of [...(details[item.id]?.subTickets ?? []), ...item.slices]) addReference(child, item.id);
    }

    // A closed parent is off the board, yet its open child still names it, as a tracker read does.
    for (const item of board.items) {
        if (!item.parent || item.parentId || item.parent.state !== 'closed' || item.recorded) continue;

        const parent = repositories.get(item.parent.repo)?.issues.get(item.parent.number);
        const child = repositories.get(item.repo)?.issues.get(item.number);

        if (parent && child) child.item.parentId = parent.item.id;
    }

    for (const repository of repositories.values()) {
        const names = new Map<string, { name: string; color: string }>();

        for (const name of repository.config.labels) names.set(name.toLowerCase(), { name, color: 'ededed' });

        for (const { item } of repository.issues.values()) {
            for (const name of item.labels)
                names.set(name.toLowerCase(), { name, color: item.labelColors?.[name]?.replace(/^#/, '') ?? 'ededed' });

            repository.nextNumber = Math.max(repository.nextNumber, item.number + 1);
        }

        repository.labels = [...names.values()];
    }

    return repositories;
}
