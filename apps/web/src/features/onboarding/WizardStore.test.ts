import type { SetupDetection } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { detection, empty, posted, project, serve } from '@/test/OnboardingTest';
import { fetchMock, sample, settle } from '@/test/PageTest';

async function start(found: SetupDetection = detection()) {
    serve(sample, [project('lar-web')], { error: null }, 200, {
        '/api/onboarding/detect': { detection: found, error: null },
        '/api/onboarding/setup': { error: null },
    });

    const { useWizardStore, stepReady } = await import('./WizardStore');

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

test('a project changed while detection runs can’t receive its stale response', async () => {
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

test('old work progress resumes on its matching step with all answers', async () => {
    const repo = 'maddec01/lar-web';
    const choices = { role: 'API', skills: ['frontend'], newLabels: { bug: ['triage'] } };
    const data = {
        ...empty,
        onboarding: [
            { repo, progress: { step: 'work', done: ['project', 'work'], answers: { projectId: 'lar-web', choices } } },
        ],
    };

    serve(data, [project('lar-web', { onBoard: true })], {}, 200, {
        '/api/onboarding/detect': { detection: detection() },
    });

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const { useWizardStore } = await import('./WizardStore');

    useBoardStore.setState({ data });
    await settle(() => useWizardStore.getState().resume(repo));
    expect(useWizardStore.getState().run).toMatchObject({ step: 'work', choices });
    await settle(() => useWizardStore.getState().close());
    expect(posted('/api/onboarding/repositories')[0]).toMatchObject({
        progress: {
            step: 'work',
            done: ['project', 'access'],
            answers: { choices },
        },
    });
});
