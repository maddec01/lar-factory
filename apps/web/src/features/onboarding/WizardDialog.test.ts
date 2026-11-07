import type { OnboardingChoices } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { detection, dialog, empty, openOnboarding, posted, project, serve } from '@/test/OnboardingTest';
import { $, chooseOption, mountPage, openOptions, settle, text } from '@/test/PageTest';

const button = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="modal-footer"] button')].find(
        (b) => text(b).trim() === label,
    )!;
const heading = () => text(dialog()!.querySelector('[data-slot="modal-header"] h2'));

async function pick(name = 'lar-web', work = true) {
    await settle(() => dialog()!.querySelector<HTMLElement>(`[data-choice="${name}"] [role="radio"]`)!.click());
    await settle(() => button('Next').click());

    if (work) await settle(() => button('Next').click());
}

test('three accessible screens lead straight to the board with no ticket picker or repository PR', async () => {
    await openOnboarding([project('lar-web')], {
        '/api/onboarding/detect': { detection: detection() },
        '/api/onboarding/setup': { error: null },
    });
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(heading()).toBe('Project');
    expect(dialog()!.textContent?.match(/Step 1 of 3/g) ?? []).toHaveLength(1);
    expect(button('Next').disabled).toBe(true);
    await pick('lar-web', false);
    expect(heading()).toBe('Access');
    expect(dialog()!.querySelector('[data-access-list]')).not.toBeNull();
    expect(document.activeElement).toBe(dialog()!.querySelector('[data-slot="modal-header"] h2'));
    await settle(() => button('Next').click());
    expect(heading()).toBe('Work and docs');
    expect(dialog()!.textContent).not.toContain('Legacy structural publication is suspended');
    expect(dialog()!.querySelector('[data-setting="domainDocs"]')).not.toBeNull();
    expect(dialog()!.querySelector('[data-import-step]')).toBeNull();
    await settle(() => button('Add Project').click());
    expect(heading()).toBe('Project added');
    expect(posted('/api/onboarding/setup')).toHaveLength(1);
    await settle(() => button('Go to the board').click());
    await settle(() => vi.advanceTimersByTime(500));
    expect(dialog()).toBeNull();
    expect($('[data-onboard]')).not.toBeNull();
});

test('onboarding omits the suspension notice and publication toggle', async () => {
    await openOnboarding([project('app', { repo: 'team/app' })], {
        '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
    });
    await pick('app');
    expect(text(dialog())).not.toContain('Legacy structural publication is suspended');
    expect(text(dialog())).not.toContain('Save concepts and cross-repository links to issues');
});

const accessRow = (name: string) =>
    [...dialog()!.querySelectorAll('[data-access-step] .settings-row')].find((row) => row.textContent?.includes(name));

test('the access step lists label management without letting it block adding the repository', async () => {
    const found = detection();

    found.access['manage-labels'] = 'refused';
    await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
    await pick('lar-web', false);
    expect(text(accessRow('Manage labels'))).toContain('Refused');
    expect(text(dialog())).toContain('New labels stay off');
    expect([...dialog()!.querySelectorAll('[data-access-list] .settings-row-title')].map(text)).toEqual([
        'Read issues',
        'Manage labels',
        'Push branches',
        'Open PRs',
    ]);
    expect(text(dialog()!.querySelector('[data-other-access]'))).toContain('Set issue types, Not checked');
    await settle(() => button('Next').click());
    expect(button('Add Project').disabled).toBe(false);
});

test('the access step names tags and shows Allowed when Azure allows managing them', async () => {
    const repo = 'organization/project/repository';

    await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
        '/api/onboarding/detect': {
            detection: detection({
                repo,
                provider: 'Azure DevOps',
                itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] },
            }),
        },
    });
    await pick('app', false);
    expect(text(accessRow('Manage tags'))).toContain('Allowed');
    expect(text(dialog())).not.toContain('You can add this repository without it.');
});

const issueSetting = (key: string) =>
    dialog()!.querySelector<HTMLButtonElement>(`[data-setting="${key}"] [role="switch"]`)!;

test('onboarding starts issue defaults on and sends individual choices', async () => {
    const repo = 'team/app';

    await openOnboarding([project('app', { repo })], {
        '/api/onboarding/detect': { detection: detection({ repo }) },
        '/api/onboarding/setup': { error: null },
    });
    await pick('app');
    for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
        expect([issueSetting(key).getAttribute('aria-checked') === 'true', issueSetting(key).disabled]).toEqual([
            true,
            false,
        ]);
    }
    await settle(() => issueSetting('createIssuesFromRetro').click());
    await settle(() => button('Add Project').click());
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        createIssuesFromAddItem: true,
        createIssuesFromRetro: false,
        writeRefinedSpec: true,
    });
});

test('onboarding shows access reasons and rechecks without losing the issue choices', async () => {
    const repo = 'team/app';
    let found = detection({ repo });

    await openOnboarding([project('app', { repo })], { '/api/onboarding/detect': () => ({ detection: found }) });
    await pick('app');
    await settle(() => issueSetting('createIssuesFromRetro').click());
    found = detection({ repo, access: { ...found.access, 'publish-ticket': 'refused', 'edit-ticket': 'unverified' } });

    const { useWizardStore } = await import('./WizardStore');

    await settle(() => useWizardStore.getState().detect());
    for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
        expect([issueSetting(key).getAttribute('aria-checked') === 'true', issueSetting(key).disabled]).toEqual([
            false,
            true,
        ]);
    }
    expect(dialog()!.querySelector('[data-setting="createIssuesFromAddItem"]')!.textContent).toContain('refused');
    expect(dialog()!.querySelector('[data-setting="writeRefinedSpec"]')!.textContent).toContain('not checked yet');
    found = detection({ repo });

    const recheck = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => text(b) === 'Recheck access',
    )!;

    await settle(() => recheck.click());
    expect([
        issueSetting('createIssuesFromAddItem').getAttribute('aria-checked') === 'true',
        issueSetting('createIssuesFromRetro').getAttribute('aria-checked') === 'true',
        issueSetting('writeRefinedSpec').getAttribute('aria-checked') === 'true',
    ]).toEqual([true, false, true]);
});

test('Azure onboarding displays the session write restriction with allowed Access', async () => {
    const repo = 'organization/project/repository';

    await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
        '/api/onboarding/detect': {
            detection: detection({
                repo,
                provider: 'Azure DevOps',
                azureReadOnly: true,
                itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] },
            }),
        },
    });
    await pick('app');
    for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
        expect([issueSetting(key).getAttribute('aria-checked') === 'true', issueSetting(key).disabled]).toEqual([
            false,
            true,
        ]);
        expect(dialog()!.querySelector(`[data-setting="${key}"]`)!.textContent).toContain('read-only');
    }
});

test('Azure onboarding picks its team in the design system Select, whose list opens above the dialog', async () => {
    const repo = 'organization/project/repository';

    await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
        '/api/onboarding/detect': {
            detection: detection({
                repo,
                provider: 'Azure DevOps',
                itemSources: {
                    found: [
                        { kind: 'azure-board', team: 'Fiber' },
                        { kind: 'azure-board', team: 'Docs' },
                    ],
                },
            }),
        },
    });
    await pick('app');

    const team = dialog()!.querySelector<HTMLElement>('[role="combobox"][aria-label="Team"]')!;

    expect(await openOptions(team)).toEqual(['Fiber', 'Docs']);
    expect(dialog()!.compareDocumentPosition($('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await chooseOption(team, 'Docs');
    expect(text(team)).toBe('Docs');
    expect(dialog()).not.toBeNull();
});

test('resuming onboarding keeps issue choices and turns legacy private docs off', async () => {
    const repo = 'team/app';
    const choices = { createIssuesFromAddItem: false, domainDocs: { kind: 'private' } } as unknown as OnboardingChoices;
    const data = {
        ...empty,
        onboarding: [{ repo, progress: { step: 'work', done: ['project'], answers: { projectId: 'app', choices } } }],
    };

    serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, {
        '/api/onboarding/detect': { detection: detection({ repo }) },
        '/api/onboarding/setup': { error: null },
    });
    await mountPage(data);
    await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
    expect(issueSetting('createIssuesFromAddItem').getAttribute('aria-checked') === 'true').toBe(false);
    expect(issueSetting('domainDocs').getAttribute('aria-checked')).toBe('false');
    await settle(() => button('Add Project').click());
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        createIssuesFromAddItem: false,
        domainDocs: { kind: 'off' },
    });
});

test('structural write refusal does not block local setup', async () => {
    const found = detection();

    found.access['comment-ticket'] = 'refused';
    await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
    await pick();
    expect(button('Add Project').disabled).toBe(false);
    expect(accessRow('Save concept maps and links')).toBeUndefined();
});

test('unverified token writes allow setup and never show Allowed for builds', async () => {
    const found = detection();

    for (const op of Object.keys(found.access) as (keyof typeof found.access)[]) found.access[op] = 'unverified';
    await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
    await pick('lar-web', false);

    const rows = [...dialog()!.querySelectorAll('[data-access-step] .settings-row')];

    expect(rows).toHaveLength(4);
    expect(rows.slice(1).every((row) => row.textContent?.includes('Not checked'))).toBe(true);
    await settle(() => dialog()!.querySelector<HTMLButtonElement>('[aria-label="About build access"]')!.click());
    expect(text(document.body)).toContain('Contents and Pull requests: Read and write');
    expect(text(document.body)).toContain('cannot verify fine-grained token permissions');
});

const vocabularyDiscovery = {
    provider: 'github',
    types: { state: 'unsupported', reason: 'No issue types here.' },
    labels: { state: 'available', choices: ['bug', 'linked-work'] },
};
const kindRow = (key: string) => dialog()!.querySelector<HTMLElement>(`[data-vocabulary="${key}"]`)!;
const rowButton = (key: string, label: string) =>
    [...kindRow(key).querySelectorAll<HTMLButtonElement>('button:not([role="combobox"])')].find(
        (b) => text(b) === label,
    )!;
const mapping = () => dialog()!.querySelector<HTMLDetailsElement>('[data-kind-mapping]')!;

/** Opens the mapping as a click does; jsdom answers a details' toggle on a timer. */
async function openMapping() {
    await settle(() => mapping().querySelector('summary')!.click());
    await settle(() => vi.advanceTimersByTime(0));
}

async function labelPicker(key: 'bug' | 'feature' | 'improvement' = 'bug') {
    await settle(() =>
        kindRow(key)
            .querySelector<HTMLButtonElement>(
                `[aria-label="Choose ${{ bug: 'Bug', feature: 'Feature', improvement: 'Improvement' }[key]} labels"]`,
            )!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));

    return document.querySelector<HTMLElement>(`[data-label-picker="${key}"]`)!;
}

async function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

const inPicker = (popover: Element, label: string) =>
    [...popover.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!;

async function workStep() {
    await openOnboarding([project('app', { repo: 'team/app' })], {
        '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
        '/api/onboarding/vocabulary': { discovery: vocabularyDiscovery },
        '/api/onboarding/setup': { error: 'Provider unavailable. Draft kept.' },
    });
    await pick('app');
}

test('the mapping is folded, marked optional and reads nothing until opened, so finishing without it sends no mapping', async () => {
    await workStep();
    expect(mapping().open).toBe(false);
    expect(text(mapping().querySelector('summary'))).toContain('Map kinds to labels and types');
    expect(text(mapping().querySelector('summary'))).toContain('Optional');
    expect(posted('/api/onboarding/vocabulary')).toEqual([]);
    await settle(() => button('Add Project').click());

    const body = posted('/api/onboarding/setup')[0]!;

    expect(body).not.toHaveProperty('vocabulary');
    expect(body).not.toHaveProperty('newLabels');
});

test('on Azure the mapping names tags', async () => {
    const repo = 'organization/project/repository';

    await openOnboarding([project('app', { repo, provider: 'Azure DevOps' })], {
        '/api/onboarding/detect': {
            detection: detection({
                repo,
                provider: 'Azure DevOps',
                itemSources: { found: [{ kind: 'azure-board', team: 'Team' }] },
            }),
        },
    });
    await pick('app');
    expect(text(mapping().querySelector('summary'))).toContain('Map kinds to tags and types');
});

test('opening the mapping changes nothing, and its suggestions stay out of the save', async () => {
    await workStep();
    await openMapping();
    expect(text(kindRow('bug'))).toContain('bug · suggested');
    await settle(() => button('Add Project').click());

    const body = posted('/api/onboarding/setup')[0]!;

    expect(body).not.toHaveProperty('vocabulary');
    expect(body).not.toHaveProperty('newLabels');
});

test('the mapping never offers the label sync needs', async () => {
    await workStep();
    await openMapping();
    expect(text(kindRow('bug'))).toContain('bug');
    expect(text(kindRow('bug'))).not.toContain('linked-work');
});

test('onboarding refuses linked-work typed as a new label without changing its drafts', async () => {
    await workStep();
    await openMapping();

    const popover = await labelPicker();

    await type(popover.querySelector('input')!, 'linked-work');
    expect(text(popover)).toContain("linked-work is reserved for the factory's saved links.");
    expect(inPicker(popover, 'Create "linked-work" when you add the Project').disabled).toBe(true);
    expect(posted('/api/onboarding/setup')).toEqual([]);
});

test('onboarding saves explicit suggestions and none and keeps failed new label drafts', async () => {
    await workStep();
    await openMapping();
    await settle(() => rowButton('bug', '+ bug · suggested').click());

    let popover = await labelPicker('feature');

    await settle(() => inPicker(popover, 'None').click());
    await settle(() => inPicker(popover, 'Done').click());
    await settle(() => vi.advanceTimersByTime(50));
    popover = await labelPicker();
    await type(popover.querySelector('input')!, 'triage');
    expect(posted('/api/onboarding/setup')).toEqual([]);
    await settle(() => inPicker(popover, 'Create "triage" when you add the Project').click());
    await settle(() => inPicker(popover, 'Done').click());
    expect(posted('/api/repositories/settings')).toEqual([]);
    await settle(() => button('Save and add Project').click());
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        vocabulary: { bug: { type: null, labels: ['bug'] }, feature: { type: null, labels: [] } },
        newLabels: { bug: ['triage'] },
    });
    expect(text(dialog())).toContain('Provider unavailable. Draft kept.');
    await settle(() => button('Back').click());
    await settle(() => button('Next').click());
    expect(mapping().open).toBe(true);
    expect(text(kindRow('bug'))).toContain('triage (new)');
});

test('unreadable vocabulary can be skipped and a retry never submits a mapping', async () => {
    let unreadable = true;

    await openOnboarding([project('app', { repo: 'team/app' })], {
        '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
        '/api/onboarding/vocabulary': () =>
            unreadable ? { error: 'Metadata unavailable.' } : { discovery: vocabularyDiscovery },
        '/api/onboarding/setup': { error: null },
    });
    await pick('app');
    await openMapping();
    expect(text(dialog())).toContain('Metadata unavailable.');
    expect(button('Add Project').disabled).toBe(false);
    unreadable = false;
    await settle(() =>
        [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Retry')!.click(),
    );
    expect(kindRow('bug')).not.toBeNull();
    await settle(() => button('Add Project').click());
    expect(posted('/api/onboarding/setup')[0]).not.toHaveProperty('vocabulary');
});

test.each(['recheck', 'resume'])(
    '%s keeps inaccessible types, labels and pending new labels until removal',
    async (how) => {
        const repo = 'team/app';
        const choices: OnboardingChoices = {
            vocabulary: { bug: { type: 'Bug', labels: ['bug'] } },
            newLabels: { bug: ['triage'] },
        };
        let found = detection({ repo, access: { ...detection().access, 'type-ticket': 'allowed' } });
        const discovery = { ...vocabularyDiscovery, types: { state: 'available', choices: ['Bug'] } };
        const data = {
            ...empty,
            onboarding: [
                { repo, progress: { step: 'work', done: ['project'], answers: { projectId: 'app', choices } } },
            ],
        };

        if (how === 'resume')
            found = {
                ...found,
                access: {
                    ...found.access,
                    'type-ticket': 'refused',
                    'tag-ticket': 'unverified',
                    'manage-labels': 'refused',
                },
            };

        serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, {
            '/api/onboarding/detect': () => ({ detection: found }),
            '/api/onboarding/vocabulary': { discovery },
            '/api/onboarding/setup': { error: null },
        });
        await mountPage(data);
        await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());

        if (how === 'recheck') {
            expect(button('Save and add Project').disabled).toBe(false);
            found = {
                ...found,
                access: {
                    ...found.access,
                    'type-ticket': 'refused',
                    'tag-ticket': 'unverified',
                    'manage-labels': 'refused',
                },
            };
            await settle(() =>
                [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
                    .find((b) => text(b) === 'Recheck access')!
                    .click(),
            );
        }

        expect(mapping().open).toBe(true);
        expect(text(kindRow('bug'))).toContain('triage (new)');
        expect(text(kindRow('bug'))).toContain('bug');
        expect(text(kindRow('bug'))).toContain('Access to Set issue types was refused');
        expect(text(kindRow('bug'))).toContain('Access to Manage labels was refused');
        expect(text(kindRow('bug'))).toContain('Access to Set labels is not checked');
        expect(button('Save and add Project').disabled).toBe(true);

        const { useWizardStore } = await import('./WizardStore');
        const denied = found;

        found = detection({ repo, access: { ...detection().access, 'type-ticket': 'allowed' } });
        await settle(() => useWizardStore.getState().detect());
        expect(button('Save and add Project').disabled).toBe(false);
        expect(useWizardStore.getState().run?.choices).toEqual(choices);
        found = denied;
        await settle(() => useWizardStore.getState().detect());
        await settle(() => rowButton('bug', 'Remove Bug').click());
        await settle(() =>
            kindRow('bug').querySelector<HTMLButtonElement>('[aria-label="Remove bug from Bug"]')!.click(),
        );
        expect(button('Save and add Project').disabled).toBe(true);
        await settle(() =>
            kindRow('bug').querySelector<HTMLButtonElement>('[aria-label="Remove triage from Bug"]')!.click(),
        );
        expect(button('Add Project').disabled).toBe(false);
        await settle(() => button('Add Project').click());
        expect(posted('/api/onboarding/setup')[0]).toMatchObject({ vocabulary: { bug: { type: null, labels: [] } } });
        expect(posted('/api/onboarding/setup')[0]).not.toHaveProperty('newLabels');
    },
);

test('a run kept on the old vocabulary step resumes on the first step with its drafts', async () => {
    const repo = 'team/app';
    const choices: OnboardingChoices = { newLabels: { bug: ['triage'] } };
    const data = {
        ...empty,
        onboarding: [
            {
                repo,
                progress: { step: 'vocabulary', done: ['project', 'work'], answers: { projectId: 'app', choices } },
            },
        ],
    };

    serve(data, [project('app', { repo, onBoard: true })], { error: null }, 200, {
        '/api/onboarding/detect': { detection: detection({ repo }) },
        '/api/onboarding/vocabulary': { discovery: vocabularyDiscovery },
    });
    await mountPage(data);
    await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
    expect(heading()).toBe('Project');
    await settle(() => button('Next').click());
    await settle(() => button('Next').click());
    expect(text(kindRow('bug'))).toContain('triage (new)');
});

const placeIcon = () =>
    dialog()!.querySelector('#onboarding-place')!.parentElement!.querySelector<HTMLElement>('[data-project-icon]');

test('the heading shows no icon until a project is picked, then its favicon, and focus stays on the step title', async () => {
    await openOnboarding([project('lar-web', { icon: { kind: 'favicon', projectId: 'lar-web', revision: 'abc' } })], {
        '/api/onboarding/detect': { detection: detection() },
    });
    expect(placeIcon()).toBeNull();
    expect(text(dialog()!.querySelector('#onboarding-place'))).toBe('Set up a Project.');
    await pick();
    expect(placeIcon()!.querySelector('img')!.getAttribute('src')).toBe('/api/project-icon/lar-web?v=abc');
    expect(text(dialog()!.querySelector('#onboarding-place')), "the dialog's description leaves the icon out").toBe(
        'Set up lar-web.',
    );
    expect(document.activeElement).toBe(dialog()!.querySelector('[data-slot="modal-header"] h2'));
});

test('the heading shows a chosen icon, or the initial for a project with none', async () => {
    await openOnboarding([project('rocket', { icon: { kind: 'emoji', emoji: '🚀' } }), project('plain')], {
        '/api/onboarding/detect': { detection: detection() },
    });
    await settle(() => dialog()!.querySelector<HTMLElement>('[data-choice="rocket"] [role="radio"]')!.click());
    expect(text(placeIcon())).toBe('🚀');
    await settle(() => dialog()!.querySelector<HTMLElement>('[data-choice="plain"] [role="radio"]')!.click());
    expect(text(placeIcon())).toBe('P');
});

test("a resumed repository whose project can't be read takes its icon from the board", async () => {
    const repo = 'team/app';
    const data = {
        ...empty,
        projectIcons: { [repo]: { kind: 'emoji', emoji: '🚀' } as const },
        onboarding: [{ repo, progress: { step: 'project', done: [], answers: { projectId: 'app' } } }],
    };

    serve(data, { error: 'T3 is down.' });
    await mountPage(data);
    await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
    expect(text(placeIcon())).toBe('🚀');
});

test.each(['push-branch', 'open-pr'] as const)(
    'docs respects %s access while preserving its saved paths and preference',
    async (operation) => {
        const repo = 'team/app';
        let found = detection({ repo });
        const choices: OnboardingChoices = {
            domainDocs: { kind: 'repository', glossary: 'WORDS.md', adrs: 'decisions' },
        };
        const data = {
            ...empty,
            onboarding: [
                { repo, progress: { step: 'work', done: ['project'], answers: { projectId: 'app', choices } } },
            ],
        };

        serve(data, [project('app', { repo, onBoard: true })], {}, 200, {
            '/api/onboarding/detect': () => ({ detection: found }),
        });
        await mountPage(data);
        await settle(() => $<HTMLButtonElement>(`[data-onboarding-card="${repo}"] [data-resume]`)!.click());
        expect(issueSetting('domainDocs').getAttribute('aria-checked')).toBe('true');
        found = { ...found, access: { ...found.access, [operation]: 'unverified' } };

        const { useWizardStore } = await import('./WizardStore');

        await settle(() => useWizardStore.getState().detect());
        expect(issueSetting('domainDocs').disabled).toBe(true);
        expect(issueSetting('domainDocs').getAttribute('aria-checked')).toBe('false');
        expect(text(issueSetting('domainDocs').closest('[data-setting]'))).toContain(
            operation === 'push-branch' ? 'Push branches' : 'Open PRs',
        );
        expect(useWizardStore.getState().run?.choices.domainDocs).toEqual(choices.domainDocs);
        found = detection({ repo });
        await settle(() => useWizardStore.getState().detect());
        expect(issueSetting('domainDocs').disabled).toBe(false);
        expect(issueSetting('domainDocs').getAttribute('aria-checked')).toBe('true');
    },
);

test('onboarding finds one of 150 labels by keyboard and keeps every edit local until add', async () => {
    const labels = Array.from({ length: 150 }, (_, i) => `label-${i}`);

    await openOnboarding([project('app', { repo: 'team/app' })], {
        '/api/onboarding/detect': { detection: detection({ repo: 'team/app' }) },
        '/api/onboarding/vocabulary': {
            discovery: { ...vocabularyDiscovery, labels: { state: 'available', choices: labels } },
        },
        '/api/onboarding/setup': { error: null },
    });
    await pick('app');
    await openMapping();

    const popover = await labelPicker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'label-149');
    expect([...popover.querySelectorAll('[role="option"]')].map(text)).toEqual(['label-149']);
    await settle(() =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    await type(input, 'no-match');
    expect(text(popover)).toContain('No labels match "no-match".');
    await settle(() => inPicker(popover, 'Done').click());
    expect(text(kindRow('bug'))).toContain('label-149');
    expect(posted('/api/onboarding/setup')).toEqual([]);
    expect(posted('/api/repositories/settings')).toEqual([]);
    await settle(() => button('Add Project').click());
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        vocabulary: { bug: { type: null, labels: ['label-149'] } },
    });
});
