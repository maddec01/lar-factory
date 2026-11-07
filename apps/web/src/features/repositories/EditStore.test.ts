import { effectiveVocabulary, type RepositorySetup } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { fetchMock, settle } from '@/test/PageTest';

const setup: RepositorySetup = {
    structureSync: true,
    repo: 'team/app',
    role: 'API',
    skills: [],
    labels: [],
    domainDocs: { kind: 'off' },
    itemSource: { kind: 'azure-board', team: 'Platform' },
    ...effectiveVocabulary(),
    access: {
        'push-branch': 'allowed',
        'open-pr': 'allowed',
        'publish-ticket': 'allowed',
        'edit-ticket': 'allowed',
        'tag-ticket': 'allowed',
        'manage-labels': 'allowed',
        'comment-ticket': 'allowed',
        'type-ticket': 'allowed',
        'relate-ticket': 'allowed',
    },
    sources: {
        role: 'local',
        itemSource: 'local',
        skills: 'local',
        domainDocs: 'local',
        labels: 'local',
        vocabulary: 'local',
        createIssuesFromAddItem: 'default',
        createIssuesFromRetro: 'default',
        writeRefinedSpec: 'default',
    },
};

test('Project saves wait their turn and an older save preserves newer text', async () => {
    const { useEditStore } = await import('./EditStore');
    const store = useEditStore.getState();
    const sent: unknown[] = [];
    const answers: ((response: Response) => void)[] = [];

    fetchMock.mockImplementation((async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string));

        return new Promise<Response>((resolve) => answers.push(resolve));
    }) as typeof fetchMock);
    store.type(setup.repo, 'role', 'First');

    const first = store.save(setup.repo, 'role', setup);

    store.type(setup.repo, 'skills', 'testing');

    const second = store.save(setup.repo, 'skills', setup);

    store.type(setup.repo, 'role', 'Newer');
    await settle();
    expect(sent).toEqual([{ repo: setup.repo, change: 'override', key: 'role', value: 'First' }]);
    await settle(() => answers[0]!(new Response('{}')));
    expect(useEditStore.getState().drafts[setup.repo]).toEqual({ role: 'Newer', skills: 'testing' });
    expect(sent).toHaveLength(2);
    await settle(() => answers[1]!(new Response('{}')));
    await Promise.all([first, second]);
    expect(useEditStore.getState().drafts[setup.repo]).toEqual({ role: 'Newer' });
});

test('field failures preserve drafts and blank required values send no request', async () => {
    const { useEditStore } = await import('./EditStore');
    const store = useEditStore.getState();

    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ error: 'Skills refused.' }), { status: 403 }),
    );
    store.type(setup.repo, 'skills', 'testing');
    await store.save(setup.repo, 'skills', setup);
    store.type(setup.repo, 'team', ' ');
    await store.save(setup.repo, 'itemSource', setup);
    store.type(setup.repo, 'domainDocs', 'repository');
    store.type(setup.repo, 'glossary', '');
    await store.save(setup.repo, 'domainDocs', setup);
    store.type(setup.repo, 'glossary', 'GLOSSARY.md');
    store.type(setup.repo, 'adrs', ' ');
    await store.save(setup.repo, 'domainDocs', setup);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useEditStore.getState().fieldErrors[setup.repo]).toMatchObject({
        skills: 'Skills refused.',
        team: 'Enter a Team.',
        adrs: 'Enter an ADR folder.',
    });
    expect(useEditStore.getState().drafts[setup.repo]).toMatchObject({ skills: 'testing', team: ' ', adrs: ' ' });
});

test('returning to an earlier value still queues the last edit and keeps its draft until it saves', async () => {
    const { useEditStore } = await import('./EditStore');
    const store = useEditStore.getState();
    const sent: unknown[] = [];
    const answers: ((response: Response) => void)[] = [];

    fetchMock.mockImplementation((async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string));

        return new Promise<Response>((resolve) => answers.push(resolve));
    }) as typeof fetchMock);
    store.type(setup.repo, 'role', 'A');

    const first = store.save(setup.repo, 'role', setup);

    store.type(setup.repo, 'role', 'B');

    const second = store.save(setup.repo, 'role', setup);

    store.type(setup.repo, 'role', 'A');

    const last = store.save(setup.repo, 'role', setup);

    await settle();
    await settle(() => answers[0]!(new Response('{}')));
    expect(useEditStore.getState().drafts[setup.repo]?.role).toBe('A');
    await settle(() => answers[1]!(new Response('{}')));
    expect(sent).toHaveLength(3);
    await settle(() => answers[2]!(new Response('{}')));
    await Promise.all([first, second, last]);
    expect(useEditStore.getState().drafts[setup.repo]?.role).toBeUndefined();
});
