import type { OnboardingChoices } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { detection, dialog, empty, openOnboarding, posted, project, serve } from '@/test/OnboardingTest';
import { $, mountPage, settle, text } from '@/test/PageTest';

const button = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="modal-footer"] button')].find(
        (b) => text(b).trim() === label,
    )!;
const heading = () => text(dialog()!.querySelector('[data-slot="modal-header"] h2'));

async function pick(name = 'lar-web', work = true) {
    await settle(() => dialog()!.querySelector<HTMLElement>(`[data-choice="${name}"] input[type="radio"]`)!.click());
    await settle(() => button('Next').click());

    if (work) await settle(() => button('Next').click());
}

const accessRow = (name: string) =>
    [...dialog()!.querySelectorAll('[data-access-step] .settings-row')].find((row) => row.textContent?.includes(name));

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
    await settle(() => button('Add project').click());
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
    expect(dialog()!.querySelector('[data-setting="writeRefinedSpec"]')!.textContent).toContain('isn’t checked yet');
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
    await settle(() => button('Add project').click());
    expect(posted('/api/onboarding/setup')[0]).toMatchObject({
        createIssuesFromAddItem: false,
        domainDocs: { kind: 'off' },
    });
});

test('structural write refusal doesn’t block local setup', async () => {
    const found = detection();

    found.access['comment-ticket'] = 'refused';
    await openOnboarding([project('lar-web')], { '/api/onboarding/detect': { detection: found } });
    await pick();
    expect(button('Add project').disabled).toBe(false);
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
    expect(text(document.body)).toContain('permission to change code and open pull requests');
    expect(text(document.body)).toContain('Sign in to GitHub with repository write access');
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

    return document
        .querySelector<HTMLElement>(`[data-label-picker="${key}"]`)!
        .closest('[data-slot="popover-content"]')!;
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
    await settle(() => button('Add project').click());

    const body = posted('/api/onboarding/setup')[0]!;

    expect(body).not.toHaveProperty('vocabulary');
    expect(body).not.toHaveProperty('newLabels');
});

test('opening the mapping changes nothing, and its suggestions stay out of the save', async () => {
    await workStep();
    await openMapping();
    expect(text(kindRow('bug'))).toContain('bug · suggested');
    await settle(() => button('Add project').click());

    const body = posted('/api/onboarding/setup')[0]!;

    expect(body).not.toHaveProperty('vocabulary');
    expect(body).not.toHaveProperty('newLabels');
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
    await settle(() => inPicker(popover, 'Create "triage" when you add the project').click());
    await settle(() => inPicker(popover, 'Done').click());
    expect(posted('/api/repositories/settings')).toEqual([]);
    await settle(() => button('Save and add project').click());
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
    expect(button('Add project').disabled).toBe(false);
    unreadable = false;
    await settle(() =>
        [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Try again')!.click(),
    );
    expect(kindRow('bug')).not.toBeNull();
    await settle(() => button('Add project').click());
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
            expect(button('Save and add project').disabled).toBe(false);
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
        expect(text(kindRow('bug'))).toContain('Access to Set labels isn’t checked');
        expect(button('Save and add project').disabled).toBe(true);

        const { useWizardStore } = await import('./WizardStore');
        const denied = found;

        found = detection({ repo, access: { ...detection().access, 'type-ticket': 'allowed' } });
        await settle(() => useWizardStore.getState().detect());
        expect(button('Save and add project').disabled).toBe(false);
        expect(useWizardStore.getState().run?.choices).toEqual(choices);
        found = denied;
        await settle(() => useWizardStore.getState().detect());
        await settle(() => rowButton('bug', 'Remove Bug').click());
        await settle(() =>
            kindRow('bug').querySelector<HTMLButtonElement>('[aria-label="Remove bug from Bug"]')!.click(),
        );
        expect(button('Save and add project').disabled).toBe(true);
        await settle(() =>
            kindRow('bug').querySelector<HTMLButtonElement>('[aria-label="Remove triage from Bug"]')!.click(),
        );
        expect(button('Add project').disabled).toBe(false);
        await settle(() => button('Add project').click());
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
    expect(heading()).toBe('Add a project');
    await settle(() => button('Next').click());
    await settle(() => button('Next').click());
    expect(text(kindRow('bug'))).toContain('triage (new)');
});
