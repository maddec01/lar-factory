import type { Item, Status } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { fakeAz } from '../azure/fake-az.ts';
import type { RepositoryConfig } from '../config/repository-config.ts';
import type { ItemSource } from './item-source.ts';
import { configuredSources, mergeSources, onboardedSources } from './item-sources.ts';

const item = (id: string, repo: string, status: Status = 'List'): Item => ({
    id,
    status,
    statuses: [status],
    content: 'ticket',
    revision: 0,
    kind: 'issue',
    parentId: null,
    flow: 'single',
    number: Number(id.slice(2)),
    title: id,
    url: `https://github.com/${repo}/issues/${id.slice(2)}`,
    repo,
    labels: [],
    state: 'open',
    closedAs: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockers: [],
    updatedAt: '2026-10-21T08:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
});

/** One shared source serving two onboarded repositories. */
const merged = (source: ItemSource) =>
    mergeSources(
        new Map([
            ['acme/api', source],
            ['acme/ios', source],
        ]),
    );

/** A source that lists `items` and records each write it is asked for. */
function fakeSource(title: string, items: Item[], writes: string[]): ItemSource {
    const write = (what: string) => async () => {
        writes.push(`${title} ${what}`);

        return null;
    };

    return {
        read: async () => ({ title, items }),
        searchTickets: async (repo, query) => {
            writes.push(`${title} search ${repo} ${query}`);

            return [];
        },
        readTicket: async (repo, number) => {
            writes.push(`${title} read ${repo}#${number}`);

            return null;
        },
        observeTicket: async (repo, number) => {
            writes.push(`${title} observe ${repo}#${number}`);

            return { state: 'open' };
        },
        abandon: async (i) => write(`abandon ${i.id}`)(),
    };
}

test("a ticket search, read and observation go to the repository's own source, and an unlisted repository's refuse", async () => {
    const writes: string[] = [];
    const source = mergeSources(
        new Map([
            ['acme/api', fakeSource('lar', [], writes)],
            ['acme/ios', fakeSource('apple', [], writes)],
        ]),
    );

    await source.searchTickets('acme/ios', 'seek');
    await source.readTicket('Acme/Api', 7);
    await source.observeTicket('acme/ios', 8);
    assert.deepEqual(writes, ['apple search acme/ios seek', 'lar read Acme/Api#7', 'apple observe acme/ios#8']);
    await assert.rejects(source.searchTickets('acme/other', 'seek'), /isn't onboarded/);
    await assert.rejects(source.observeTicket('acme/other', 8), /isn't onboarded/);
});

test('with no source a read lists nothing and an abandon is refused', async () => {
    const sources = mergeSources(new Map());

    assert.deepEqual(await sources.read(), { title: '', items: [] });
    assert.equal(await sources.abandon(item('I_1', 'acme/api')), "That item's Project isn't onboarded.");
});

const config = (repo: string): RepositoryConfig => ({ repo, role: 'role', itemSource: { kind: 'issues' }, labels: [] });

test('each read loads the configs first and builds the sources again only when they changed', async () => {
    let configs = [config('acme/ios')];
    const built: string[][] = [];
    const sources = onboardedSources(
        async () => ({ configs, problems: [] }),
        (read) => {
            built.push(read.map((c) => `${c.repo} ${c.labels.join(',')}`));

            return merged(fakeSource(read.map((c) => c.repo).join(',') || 'none', [], []));
        },
    );

    assert.deepEqual(sources.repos(), []);
    assert.equal((await sources.read()).title, 'acme/ios');
    await sources.read();
    configs = [{ ...config('acme/ios'), labels: ['app: music'] }, config('acme/api')];
    assert.equal((await sources.read()).title, 'acme/ios,acme/api');
    assert.deepEqual(built, [[], ['acme/ios '], ['acme/ios app: music', 'acme/api ']]);
    assert.deepEqual(sources.repos(), [
        { repo: 'acme/ios', role: 'role', items: 'issues', labels: ['app: music'] },
        { repo: 'acme/api', role: 'role', items: 'issues', labels: [] },
    ]);
});

const azure = (repo: string, team = 'Fabrikam Team'): RepositoryConfig => ({
    repo,
    role: 'role',
    itemSource: { kind: 'azure-board', team },
    labels: [],
});

/** A source that counts its reads and lists `items` as they are at each read. */
function countedSource(name: string, items: () => Item[]): ItemSource & { reads: number } {
    const source = {
        ...fakeSource(name, [], []),
        name,
        reads: 0,
        read: async () => {
            source.reads++;

            return { title: name, items: items() };
        },
    };

    return source;
}

const pace = (now: number, active: (i: Item) => boolean = (i) => i.status === 'In progress') => ({
    now,
    active,
    polled: (i: Item) => i.status === 'Review',
});

test("invalidating an item reads only the source that lists it, at once, and an unknown one reads its repository's source", async () => {
    const apple = countedSource('apple', () => [
        {
            ...item('I_1', 'acme/ios'),
            slices: [
                {
                    number: 9,
                    title: 's',
                    url: 'https://github.com/acme/ios/issues/9',
                    state: 'open',
                    repo: 'acme/ios',
                    progress: 'active',
                },
            ],
        },
    ]);
    const server = countedSource('server', () => [item('I_2', 'acme/api')]);
    const sources = mergeSources(
        new Map([
            ['acme/ios', apple],
            ['acme/api', server],
        ]),
    );

    await sources.read(undefined, pace(0));
    sources.invalidate('https://github.com/acme/ios/issues/9');
    assert.equal(sources.due(pace(1_999)), false, 'two reads of one source are at least 2 seconds apart');
    await sources.read(undefined, pace(2_000));
    assert.deepEqual([apple.reads, server.reads], [2, 1]);
    sources.invalidate('https://github.com/acme/ios/issues/404');
    await sources.read(undefined, pace(4_000));
    assert.deepEqual([apple.reads, server.reads], [3, 1]);
});

test('a source that reads items alone reads only its active and asked-for items between its whole reads', async () => {
    let listed = [
        item('I_1', 'acme/ios', 'In progress'),
        item('I_2', 'acme/ios', 'Queued'),
        item('I_3', 'acme/ios', 'Queued'),
    ];
    const some: string[][] = [];
    const project = Object.assign(
        countedSource('project', () => listed),
        {
            readSome: async (items: Item[]) => {
                some.push(items.map((i) => i.id));

                return listed.filter((i) => items.some((asked) => asked.id === i.id));
            },
        },
    );
    const sources = mergeSources(new Map([['acme/api', project]]));

    await sources.read(undefined, pace(0));
    listed = [{ ...listed[0]!, status: 'Review', statuses: ['Review'] }, listed[1]!];

    const read = await sources.read(undefined, pace(15_000));

    assert.deepEqual([project.reads, some], [1, [['I_1']]]);
    assert.deepEqual(
        read.items.map((i) => `${i.id}:${i.status}`),
        ['I_1:Review', 'I_2:Queued', 'I_3:Queued'],
        'the idle items keep their last read',
    );
    assert.equal(sources.readAfresh(read.items[0]!), true);
    assert.equal(sources.readAfresh(read.items[1]!), false);
    sources.invalidate(listed[1]!.url!);
    sources.invalidate('https://github.com/acme/ios/issues/3');

    const asked = await sources.read(undefined, pace(17_000));

    assert.deepEqual(some.at(-1), ['I_2', 'I_3'], 'the asked-for items read at once, alone');
    assert.deepEqual(
        asked.items.map((i) => i.id),
        ['I_1', 'I_2'],
        'an asked-for item the source no longer lists leaves',
    );
    await sources.read(undefined, pace(300_000));
    assert.equal(project.reads, 2, 'the idle interval reads it whole');
});

test('a read that fails after a change check asks again for what it read, at the active pace', async () => {
    let fail = false;
    const some: string[][] = [];
    const issues = Object.assign(
        countedSource('issues', () => [item('I_1', 'acme/ios', 'Queued')]),
        {
            seesEdits: true,
            readSome: async (items: Item[]) => {
                some.push(items.map((i) => i.id));

                if (fail) throw new Error('timeout');

                return items;
            },
            changes: async () => ['https://github.com/Acme/Ios/issues/1'],
        },
    );
    const read = issues.read;

    issues.read = async () => {
        if (fail) throw new Error('timeout');

        return read();
    };

    const sources = mergeSources(new Map([['acme/ios', issues]]));

    await sources.read(undefined, pace(0));
    fail = true;
    await sources.probe(pace(5_000));
    assert.deepEqual(some, [], 'nothing read yet');
    await assert.rejects(sources.read(undefined, pace(5_000)), /timeout/);
    assert.deepEqual(some, [['I_1']], 'the URL matches whatever its case');
    fail = false;
    assert.equal(sources.due(pace(19_999)), false, 'a failed source waits out the active pace');
    await sources.read(undefined, pace(20_000));
    assert.equal(issues.reads, 2, 'the change the check found still reads');
});

test('an item read alone keeps the map its whole read gave it, as a dossier read alone has none', async () => {
    const map = { sections: [] } as unknown as NonNullable<Item['map']>;
    const project = Object.assign(
        countedSource('project', () => [{ ...item('I_1', 'acme/ios', 'In progress'), map }]),
        {
            readSome: async (items: Item[]) => items.map(({ map: _, ...rest }) => rest),
        },
    );
    const sources = merged(project);

    await sources.read(undefined, pace(0));

    const read = await sources.read(undefined, pace(15_000));

    assert.equal(read.items[0]!.map, map);
});

test('repositories reading one Azure board share its backlog and sprint and route tagged items', async () => {
    const az = fakeAz({
        items: [
            { id: 1, type: 'User Story', state: 'New' },
            { id: 2, type: 'User Story', state: 'Active', tags: 'repo-api' },
        ],
        backlog: [1, 2],
        sprint: [2],
    });
    const configs = [azure('contoso/Fabrikam/web'), azure('Contoso/fabrikam/api', 'fabrikam team')].map((config) => ({
        ...config,
        itemSource: {
            kind: 'azure-board' as const,
            team: config.itemSource.kind === 'azure-board' ? config.itemSource.team : '',
        },
    }));
    const read = await configuredSources(configs, az.run).read();

    assert.deepEqual(
        read.items.map((i) => [i.number, i.repo, i.untaggedFor ?? null]),
        [
            [1, 'contoso/Fabrikam/web', ['contoso/Fabrikam/web', 'Contoso/fabrikam/api']],
            [2, 'Contoso/fabrikam/api', null],
        ],
    );
    assert.equal(az.calls.filter((c) => c[3] === 'list-work-items').length, 1);
    assert.equal(
        az.calls.filter((c) => c.includes('backlogs') && c.includes('id=Microsoft.RequirementCategory/workItems'))
            .length,
        1,
    );
});
