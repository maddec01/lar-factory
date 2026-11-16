// The sample board's scenarios (`pnpm run sample`): the bundled fixture reshaped so every lane, card and state the board
// draws has an example. Azure work at every stage, ticketless work, builds at work with slices, without and in review,
// a concept's parts building, and questions with their summaries. Every name, organisation and link is invented or
// already in the bundled fixture; no project images ride along, so projects show their initials. The desk's other
// waits (a tool approval, a brief approval, a failed outcome, follow-ups, a growing concept) go through the sample's
// own controls once the board runs (SAMPLE_DESK_SCENARIOS).

import type { BoardData, Item, ItemThread, LinkedPr } from '@lar-factory/shared';

/** The sample controls that put the desk's other waits in place, in order, once the sample board runs. */
export const SAMPLE_DESK_SCENARIOS: Record<string, unknown>[] = [
    { action: 'tool-approval', change: 'seed' },
    { action: 'brief-approval' },
    { action: 'failed-outcome' },
    { action: 'retro', change: 'seed' },
    { action: 'growing-concept' },
];

/** Items the scenarios leave out, so the lanes hold one example of each case rather than many alike. */
const LEFT_OUT = new Set([
    'I_sample01',
    'I_sample21',
    'I_sample06',
    'I_sample15',
    'I_sample27',
    'I_sample02',
    'azure:contoso/5661',
    'azure:contoso/6164',
    'azure:contoso/4870',
    'azure:contoso/5833',
    'azure:contoso/6766',
    'azure:contoso/6774',
    'azure:contoso/5793',
    'azure:contoso/6841',
    'azure:contoso/6842',
]);

const SERVER = 'maddec01/lar-server';
const APPLE = 'maddec01/lar-apple';
const PLATFORM = 'maddec01/lar-platform';
const MOBILE = 'contoso/Mobile%20App/mobile-app';
const AZURE = 'https://dev.azure.com/contoso/Mobile%20App';

/** `fixture` with every scenario in place, its running work stamped as of `now`. */
export function withScenarios(fixture: BoardData, now = Date.now()): BoardData {
    const data = structuredClone(fixture);
    const items: Item[] = data.items.filter((item) => !LEFT_OUT.has(item.id));
    const get = (id: string) => {
        const item = items.find((candidate) => candidate.id === id);

        if (!item) throw new Error(`The sample fixture has no item ${id}.`);

        return item;
    };
    const set = (id: string, status: Item['status'], extra: Partial<Item> = {}) =>
        Object.assign(get(id), { status, statuses: [status] }, extra);
    const base = get('96c76c35-a621-5075-8d2e-a7bb2379eb0f');
    const local = (id: string, item: Partial<Item>) =>
        items.push({
            ...structuredClone(base),
            id,
            number: 0,
            url: null,
            labels: [],
            labelColors: {},
            parent: null,
            parentId: null,
            blockers: [],
            ...item,
        } as Item);
    const minuteAgo = new Date(now - 60_000).toISOString();
    const hoursAgo = new Date(now - 3 * 3_600_000).toISOString();
    const running = (id: string, title: string, action: string): ItemThread[] => [
        {
            id,
            title,
            state: 'running',
            updated: minuteAgo,
            purpose: 'build',
            currentRunning: true,
            activity: {
                available: true,
                readAt: '2100-01-01T00:00:00.000Z',
                action,
                actionAt: minuteAgo,
                toolRunning: true,
                agents: [],
            },
        } as ItemThread,
    ];
    const pr = (
        repo: string,
        number: number,
        checks: { passed: number; running: number; total: number },
        isDraft = false,
    ) =>
        ({
            number,
            url: `https://github.com/${repo}/pull/${number}`,
            state: 'open',
            isDraft,
            checks: { ...checks, failed: 0, since: '2026-10-21T09:40:00Z' },
            checkProgress: { state: 'current', coverage: 'all' },
            mergeState: 'checking',
        }) as LinkedPr;
    const slice = (repo: string, number: number, title: string, progress: string, state = 'open') => ({
        number,
        title,
        url: `https://github.com/${repo}/issues/${number}`,
        repo,
        state,
        progress,
    });
    const building = (id: string, item: Partial<Item>) =>
        local(id, {
            status: 'In progress',
            statuses: ['In progress'],
            buildStarted: true,
            passingBrief: true,
            createdAt: '2026-10-18T09:00:00.000Z',
            updatedAt: minuteAgo,
            stats: { agentMs: 2_400_000, wallMs: 1_800_000, tokens: 3_200_000, costUsd: 4.9 },
            ...item,
        } as Partial<Item>);

    // Azure DevOps work at every stage, one in review with its checks running.
    set('azure:contoso/6765', 'Queued', { updatedAt: '2026-11-02T10:00:00Z' });
    set('azure:contoso/6167', 'Shaping');
    set('azure:contoso/6163', 'Ready');
    set('azure:contoso/6318', 'In progress', { linkedPrs: [] });
    set('azure:contoso/5672', 'Review', {
        linkedPrs: [
            {
                ...pr(MOBILE, 907, { passed: 2, running: 3, total: 5 }),
                url: `${AZURE}/_git/mobile-app/pullrequest/907`,
            },
        ],
    });
    // A GitHub ticket ready to build, held by nothing.
    set('I_sample04', 'Ready', { kind: 'improvement' });

    // Ticketless work saved only on this machine, in three lanes.
    local('0c0a0000-0000-4000-8000-000000000001', {
        title: 'Tidy the transcoder temp folder on startup',
        kind: 'improvement',
        repo: SERVER,
        status: 'Queued',
        statuses: ['Queued'],
        createdAt: '2026-11-05T09:00:00.000Z',
        updatedAt: '2026-11-05T09:00:00.000Z',
    });
    local('0c0a0000-0000-4000-8000-000000000002', {
        title: 'Health endpoint for the household registry',
        kind: 'build',
        repo: PLATFORM,
        status: 'Ready',
        statuses: ['Ready'],
        passingBrief: true,
        createdAt: '2026-11-03T09:00:00.000Z',
        updatedAt: '2026-11-08T09:00:00.000Z',
    });
    local('0c0a0000-0000-4000-8000-000000000003', {
        title: 'Library search ignores accents in titles',
        kind: 'bug',
        repo: APPLE,
        status: 'Shaping',
        statuses: ['Shaping'],
        createdAt: '2026-11-06T09:00:00.000Z',
        updatedAt: '2026-11-10T09:00:00.000Z',
    });

    // Builds at work: one with every slice done, one in review with its checks, one with none, a draft PR's, an Azure one.
    building('0c0a0000-0000-4000-8000-000000000011', {
        number: 52,
        url: `https://github.com/${APPLE}/issues/52`,
        title: 'Picture-in-picture on iPad',
        kind: 'feature',
        repo: APPLE,
        labels: ['feature'],
        buildPhase: 'implement',
        slices: [
            slice(APPLE, 53, 'Start PiP from the player', 'done', 'closed'),
            slice(APPLE, 54, 'Restore the player when PiP ends', 'done', 'closed'),
            slice(APPLE, 55, 'Keep subtitles in the PiP window', 'done', 'closed'),
        ],
        threads: running('sample-thread-52', 'Build: picture-in-picture on iPad', 'Run xcodebuild test'),
    } as Partial<Item>);
    building('0c0a0000-0000-4000-8000-000000000015', {
        status: 'Review',
        statuses: ['Review'],
        number: 61,
        url: `https://github.com/${SERVER}/issues/61`,
        title: 'Arr instances, catalog bindings and content requests',
        kind: 'feature',
        repo: SERVER,
        labels: ['feature'],
        buildPhase: 'full-checks',
        stats: undefined,
        slices: [
            slice(SERVER, 62, 'Register Arr instances', 'done', 'closed'),
            slice(SERVER, 63, 'Bind catalogs to instances', 'done', 'closed'),
        ],
        linkedPrs: [pr(SERVER, 64, { passed: 6, running: 4, total: 10 })],
        threads: running('sample-thread-61', 'Build: Arr instances', 'Run full checks'),
    } as Partial<Item>);
    building('0c0a0000-0000-4000-8000-000000000012', {
        number: 158,
        url: `https://github.com/${SERVER}/issues/158`,
        title: 'Rate-limit failed sign-in attempts',
        kind: 'improvement',
        repo: SERVER,
        labels: ['improvement', 'area: server'],
        buildPhase: 'implement',
        stats: undefined,
        threads: running('sample-thread-158', 'Build: rate-limit failed sign-ins', 'Edit auth/throttle.ts'),
    } as Partial<Item>);
    building('0c0a0000-0000-4000-8000-000000000013', {
        status: 'Review',
        statuses: ['Review'],
        title: 'Rotate the registry signing keys every month',
        kind: 'build',
        repo: PLATFORM,
        buildPhase: 'checks',
        linkedPrs: [pr(PLATFORM, 88, { passed: 5, running: 3, total: 8 }, true)],
        threads: running('sample-thread-keys', 'Build: rotate registry signing keys', 'Run pnpm test'),
    } as Partial<Item>);
    building('0c0a0000-0000-4000-8000-000000000014', {
        number: 6841,
        url: `${AZURE}/_workitems/edit/6841`,
        title: 'Dark mode for the backoffice',
        kind: 'feature',
        repo: MOBILE,
        labels: ['Backoffice'],
        azure: { type: 'Product Backlog Item', state: 'Committed', assignee: 'Sam Rivera' },
        buildPhase: 'plan',
        threads: running('sample-thread-6841', 'Build: dark mode for the backoffice', 'Read theme/tokens.ts'),
    } as Partial<Item>);

    // A concept's builds while they run: #140 with slices (one done, one under way, one waiting), #141 with none.
    const owners = get('I_sample13');
    const threadsOf = (item: Item): ItemThread[] => (Array.isArray(item.threads) ? [...item.threads] : []);

    set('I_sample13', 'In progress', {
        buildStarted: true,
        passingBrief: true,
        recorded: true,
        blockers: [],
        buildPhase: 'implement',
        updatedAt: minuteAgo,
        threads: [
            ...threadsOf(owners),
            ...running('sample-thread-140-build', 'Build: owner accounts', 'Edit server/sessions.ts'),
        ],
    } as Partial<Item>);
    items.push({
        ...structuredClone(owners),
        id: 'I_sample13b',
        number: 141,
        url: `https://github.com/${SERVER}/issues/141`,
        title: 'Discovery service that finds a household server on the local network',
        slices: [],
        buildPhase: 'checks',
        threads: running('sample-thread-141', 'Build: discovery service', 'Run pnpm test'),
    } as Item);

    // An Azure work item waiting on a shaping question, so the desk shows a work item and its question.
    local('0c0a0000-0000-4000-8000-000000000021', {
        number: 6912,
        url: `${AZURE}/_workitems/edit/6912`,
        title: 'Offline downloads for the tablet app',
        kind: 'feature',
        repo: MOBILE,
        labels: ['Tablet'],
        status: 'Shaping',
        statuses: ['Shaping'],
        azure: { type: 'Product Backlog Item', state: 'Approved', assignee: 'Jordan Lee' },
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: hoursAgo,
        threads: [
            {
                id: 'sample-thread-6912',
                title: 'Shape: offline downloads',
                purpose: 'shape',
                state: 'needs you',
                updated: hoursAgo,
                questionSummary: 'Should downloads expire after 30 days offline, or only when the licence is revoked?',
            } as ItemThread,
        ],
    } as Partial<Item>);

    // A desk card with its question and the concept it belongs to under its title.
    const signIn = get('I_sample12');

    const [question, ...rest] = threadsOf(signIn);

    Object.assign(signIn, {
        recorded: true,
        threads: question && [
            {
                ...question,
                questionSummary:
                    'Should the sign-in screen offer a passkey first, or keep email and password as the default?',
            },
            ...rest,
        ],
    });

    return { ...data, items };
}
