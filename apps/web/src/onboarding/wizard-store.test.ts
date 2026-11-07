import type { SetupDetection } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { fetchMock, sample, settle } from '../../test/support.ts';
import { detection, empty, posted, project, serve } from './onboarding-support.ts';

async function start(found: SetupDetection = detection()) {
    serve(sample, [project('lar-web')], { error: null }, 200, {
        '/api/onboarding/detect': { detection: found, error: null },
        '/api/onboarding/setup': { error: null },
    });

    const { useWizardStore, stepReady } = await import('./wizard-store.ts');

    await settle(() => useWizardStore.getState().start());
    useWizardStore.getState().pick('lar-web');
    await settle(() => useWizardStore.getState().next());
    await settle(() => useWizardStore.getState().next());

    return {
        wizard: useWizardStore,
        ready: () => {
            const { run, projects, detection: read } = useWizardStore.getState();

            return stepReady(run!, projects, read);
        },
    };
}

const noRepo = { repo: null, provider: null };

test("each project that can't be picked gets its own reason", async () => {
    const { unpickable } = await import('./wizard-store.ts');
    const run = { step: 'project', projectId: null, repo: null, provider: null, savedAs: null, choices: {} } as const;
    const repo = 'maddec01/lar-web';
    const onBoard = project('lar-web', { onBoard: true });

    expect(unpickable(project('lar-web'), run, empty)).toBeNull();
    expect(unpickable(project('app', { ...noRepo, blocked: 'linked-worktree' }), run, empty)).toBe(
        'This folder is a git worktree. Add its main checkout instead.',
    );
    expect(unpickable(project('app', { ...noRepo, blocked: 'no-provider-origin' }), run, empty)).toBe(
        'This folder has no GitHub or Azure DevOps origin.',
    );
    expect(unpickable(onBoard, run, empty)).toBe('This Project is already on the board.');
    expect(
        unpickable(onBoard, run, {
            onboarding: [{ repo, progress: { step: 'work', done: [], answers: { projectId: 'lar-web' } } }],
        }),
    ).toBe('Setup is already in progress. Close this window and choose Resume.');
    expect(unpickable(onBoard, { ...run, savedAs: repo }, empty)).toBeNull();
});

test('adding a folder T3 lists as a worktree shows the same reason and picks nothing', async () => {
    const added = project('app', { ...noRepo, blocked: 'linked-worktree' });

    serve(sample, [], { error: null }, 200, {
        '/api/onboarding/projects': (body) =>
            'folder' in body ? { projects: [added], projectId: 'app' } : { projects: [] },
    });

    const { useWizardStore } = await import('./wizard-store.ts');

    await settle(() => useWizardStore.getState().start());
    useWizardStore.getState().chooseNew();
    useWizardStore.getState().setFolder('~/app');
    await settle(() => useWizardStore.getState().createProject());
    expect(useWizardStore.getState().creating?.error).toBe(
        "T3 Code added the project, but it can't be picked: This folder is a git worktree. Add its main checkout instead.",
    );
    expect(useWizardStore.getState().run?.projectId).toBeNull();
});

test('onboarding chooses a source without importing individual tickets or changing repository files', async () => {
    const { wizard, ready } = await start();

    expect(wizard.getState().run?.step).toBe('work');
    expect(ready()).toBe(true);
    await settle(() => wizard.getState().save());
    expect(wizard.getState().finish.state).toBe('done');
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        repo: 'maddec01/lar-web',
        projectId: 'lar-web',
        role: '',
        itemSource: { kind: 'issues' },
        structureSync: true,
        domainDocs: { kind: 'off' },
    });

    const routes = fetchMock.mock.calls.map(([url]) => url);

    expect(routes.some((url) => /onboarding\/(?:import|pr(?:\/|$))|config/.test(url))).toBe(false);
});

test('legacy enabled sync does not require structural access for setup', async () => {
    const found = detection();

    found.access['comment-ticket'] = 'unverified';

    const { wizard, ready } = await start(found);

    expect(ready()).toBe(true);
    await settle(() => wizard.getState().save());
    expect(posted('/api/onboarding/setup')).toHaveLength(1);
});

test('an Azure source needs a readable team, not individual item picks', async () => {
    const { wizard, ready } = await start(detection({ provider: 'Azure DevOps', itemSources: { found: [] } }));

    expect(ready()).toBe(false);
    wizard.getState().choose({ itemSource: { kind: 'azure-board', team: 'Example App' }, structureSync: false });
    expect(ready()).toBe(true);
});

test('a refused checkout cannot finish even with sync off', async () => {
    const { wizard, ready } = await start(detection({ checkout: { refused: 'Use the main checkout.' } }));

    wizard.getState().choose({ structureSync: false });
    expect(ready()).toBe(false);
});

test('closing preserves choices for an explicit resume', async () => {
    const { wizard } = await start();

    wizard.getState().choose({ structureSync: false, role: 'API server' });
    await settle(() => wizard.getState().close());
    expect(posted('/api/onboarding/repositories')[0]).toMatchObject({
        repo: 'maddec01/lar-web',
        progress: { step: 'work', answers: { choices: { structureSync: false, role: 'API server' } } },
    });
    expect(wizard.getState().run).toBeNull();
});

test('a project changed while detection runs cannot receive its stale response', async () => {
    const { wizard } = await start();
    let answer!: (response: Response) => void;

    fetchMock.mockImplementation(
        () =>
            new Promise<Response>((resolve) => {
                answer = resolve;
            }),
    );

    const pending = wizard.getState().detect();

    wizard.getState().chooseNew();
    await settle(() => answer(new Response(JSON.stringify({ detection: detection() }))));
    await pending;
    expect(wizard.getState().detection).toBeNull();
});

test.each(['project', 'work', 'access'] as const)(
    'old %s progress resumes on its matching step with all answers',
    async (step) => {
        const repo = 'maddec01/lar-web';
        const choices = { role: 'API', skills: ['frontend'], newLabels: { bug: ['triage'] } };
        const data = {
            ...empty,
            onboarding: [
                { repo, progress: { step, done: ['project', 'work'], answers: { projectId: 'lar-web', choices } } },
            ],
        };

        serve(data, [project('lar-web', { onBoard: true })], {}, 200, {
            '/api/onboarding/detect': { detection: detection() },
        });

        const { useBoardStore } = await import('../board/board-store.ts');
        const { useWizardStore } = await import('./wizard-store.ts');

        useBoardStore.setState({ data });
        await settle(() => useWizardStore.getState().resume(repo));
        expect(useWizardStore.getState().run).toMatchObject({ step, choices });
        await settle(() => useWizardStore.getState().close());
        expect(posted('/api/onboarding/repositories')[0]).toMatchObject({
            progress: {
                step,
                done: { project: [], access: ['project'], work: ['project', 'access'] }[step],
                answers: { choices },
            },
        });
    },
);

test('Access runs second and lets a saved inaccessible mapping reach Work for removal', async () => {
    const { wizard, ready } = await start();

    wizard.getState().back();
    expect(wizard.getState().run?.step).toBe('access');
    wizard.getState().choose({ vocabulary: { bug: { type: 'Bug', labels: [] } } });
    expect(ready()).toBe(true);
    await settle(() => wizard.getState().next());
    expect(wizard.getState().run?.step).toBe('work');
    expect(ready()).toBe(false);
    wizard.getState().choose({ vocabulary: { bug: { type: null, labels: [] } } });
    expect(ready()).toBe(true);
});
