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
