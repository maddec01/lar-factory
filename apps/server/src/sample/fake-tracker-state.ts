import {
    parseConceptMap,
    type Item,
    type ItemDetails,
    type Kind,
    type RepoConfig,
    type TrackerLabel,
} from '@lar-factory/shared';

export interface FakeIssue {
    item: Item;
    details: ItemDetails;
    type: string | null;
}

export interface FakeRepository {
    config: RepoConfig;
    labels: TrackerLabel[];
    issues: Map<number, FakeIssue>;
    creates: Map<string, { request: string; number: number }>;
    nextNumber: number;
}

export interface FakeIssueDraft {
    /** Stable per logical creation, including retries after a write succeeded but its read failed. */
    identity: string;
    title: string;
    body: string;
    kind: Kind;
    labels?: string[];
    type?: string | null;
}

export type FakeIssueEdit = Partial<Pick<FakeIssueDraft, 'title' | 'body' | 'kind'>> &
    Partial<Pick<Item, 'state' | 'closedAs' | 'map'>>;

export const FAKE_OWNER = 'lar-factory-sample';
export const FAKE_TIME = '2026-10-24T08:00:00.000Z';

export function fakeRepository(repositories: Map<string, FakeRepository>, repo: string): FakeRepository {
    if (!repo.startsWith(`${FAKE_OWNER}/`) || !repositories.has(repo))
        throw new Error('Sample tracker only accepts its seeded fake repositories.');

    return repositories.get(repo)!;
}

export function fakeIssue(repository: FakeRepository, number: number): FakeIssue {
    const issue = repository.issues.get(number);

    if (!issue) throw new Error(`Sample ticket #${number} does not exist.`);

    return issue;
}

export function emptyDetails(body = ''): ItemDetails {
    return {
        body,
        format: 'markdown',
        author: 'sample',
        assignees: [],
        createdAt: FAKE_TIME,
        subTickets: [],
        comments: [],
        hasOlderComments: false,
        olderCursor: null,
    };
}

export function newFakeIssue(repo: string, number: number, draft: Omit<FakeIssueDraft, 'identity'>): FakeIssue {
    return {
        item: {
            id: `sample:${repo}#${number}`,
            revision: 0,
            status: 'List',
            statuses: [],
            kind: draft.kind,
            ...(draft.type && { issueType: draft.type }),
            ...(draft.kind === 'concept' && { map: parseConceptMap(draft.body) }),
            content: 'ticket',
            number,
            title: draft.title,
            url: `https://github.com/${repo}/issues/${number}`,
            repo,
            labels: [...(draft.labels ?? [])],
            state: 'open',
            closedAs: null,
            parent: null,
            parentId: null,
            subIssues: { total: 0, completed: 0 },
            blockers: [],
            updatedAt: FAKE_TIME,
            closedAt: null,
            linkedPrs: [],
            slices: [],
        },
        details: emptyDetails(draft.body),
        type: draft.type ?? null,
    };
}
