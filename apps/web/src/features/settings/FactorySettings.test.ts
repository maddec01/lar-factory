import { defaultFactorySettings, type FactorySettingsState } from '@lar-factory/shared/factory-settings';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, openOptions, sample, settle, text } from '@/test/PageTest';

let state: FactorySettingsState;
let failSave = false;
const button = (label: string) => $$<HTMLButtonElement>('button').find((entry) => text(entry) === label)!;
const input = (label: string) => $<HTMLInputElement>(`[aria-label="${label}"]`)!;

async function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element) as object, 'value')!.set!.call(element, value);
    await settle(() => element.dispatchEvent(new Event('input', { bubbles: true })));
}

async function pick(label: string, option: string, index = 0) {
    await openOptions($$<HTMLButtonElement>(`[aria-label="${label}"]`)[index]!);
    await settle(() =>
        $$<HTMLElement>('[role="option"]')
            .find((entry) => text(entry) === option)!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
}

async function save() {
    await settle(() => button('Save changes').click());
}

async function open() {
    failSave = false;
    state = {
        settings: defaultFactorySettings(),
        revision: '0',
        defaults: {
            code: 'Default code',
            security: 'Default security',
            ui: 'Default UI',
            performance: 'Default performance',
        },
        models: [
            {
                instanceId: 'codex',
                name: 'Codex',
                models: [{ slug: 'model-a', label: 'Model A', efforts: [{ value: 'high', label: 'High' }] }],
            },
        ],
    };
    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
        if (url === '/api/factory-settings') {
            if (init?.method === 'POST') {
                if (failSave)
                    return new Response(JSON.stringify({ error: 'Settings changed in another window.' }), {
                        status: 409,
                    });

                const body = JSON.parse(init.body as string) as FactorySettingsState;

                state = { ...state, settings: body.settings, revision: String(Number(state.revision) + 1) };
            }

            return new Response(JSON.stringify(state));
        }

        return new Response(JSON.stringify(sample));
    }) as never);
    await mountPage(sample);
    await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() => button('Reviewers and models').click());
}

test('changes packaged reviewer mode, duplicates it and only edits the copy', async () => {
    await open();
    expect(text($('[aria-label="Shaping model"]')!)).toBe('Project default in T3');
    expect(text($('[aria-label="Planner model"]')!)).toBe('Same as its thread');
    expect(input('Reviewer name')).toBeNull();
    expect($('textarea')).toBeNull();
    expect($('[aria-label="Reviewer"]')).toBeNull();
    expect($('[aria-label="Thread kind"]')).toBeNull();
    expect($('[aria-label="Role"]')).toBeNull();
    expect($$('table[aria-label="Thread defaults"] tbody tr')).toHaveLength(4);
    expect($$('table[aria-label="Roles"] tbody tr').length).toBeGreaterThan(10);
    expect(button('Restore default instructions')).toBeUndefined();
    await settle(() => {
        const disclosure = $<HTMLDetailsElement>('[aria-label="Security reviewer"] details')!;

        disclosure.open = true;
        disclosure.dispatchEvent(new Event('toggle'));
    });
    expect(text($('[aria-label="Security reviewer"]')!)).toContain('Default security');
    expect($('textarea')).toBeNull();
    expect($('[aria-label="Trigger"]')).toBeNull();
    // Duplicate is an icon button, named for its reviewer.
    await settle(() =>
        $<HTMLButtonElement>('[aria-label="Security reviewer"] button[aria-label="Duplicate Security"]')!.click(),
    );
    expect(input('Reviewer name').value).toBe('Security (copy)');
    expect(document.activeElement).toBe(input('Reviewer name'));
    expect(input('Reviewer name').readOnly).toBe(false);
    expect($<HTMLTextAreaElement>('textarea')!.value).toBe('Default security');
    expect(text($('[aria-label="Trigger"]')!)).toBe('Security changes');
    await enter($<HTMLTextAreaElement>('textarea')!, 'Check custom security rules');
    await save();

    const copy = state.settings.reviewers.at(-1)!;

    expect(copy.id).not.toBe('security');
    expect(copy.revisions).toEqual([
        { revision: 1, text: 'Default security' },
        { revision: 2, text: 'Check custom security rules' },
    ]);
    expect(state.settings.reviewers[1]).not.toHaveProperty('revisions');
    await pick('Security review mode', 'Never');
    await save();
    await settle(() => button('General').click());
    await settle(() => button('Reviewers and models').click());
    expect(text($('[aria-label="Security review mode"]')!)).toBe('Never');
    expect($('textarea')).toBeNull();
    await settle(() => button('Edit').click());
    expect($<HTMLTextAreaElement>('textarea')!.value).toBe('Check custom security rules');
});

test('adds, edits and removes a custom reviewer with a trigger and its model override', async () => {
    await open();
    await settle(() => button('Add reviewer').click());
    expect(document.activeElement).toBe(input('Reviewer name'));
    await enter(input('Reviewer name'), 'Docs');
    await enter($<HTMLTextAreaElement>('textarea')!, 'Check examples');
    await pick('Docs review mode', 'On trigger');
    await enter(input('Rule 1 pattern'), 'docs/**');
    await save();

    const id = state.settings.reviewers.at(-1)!.id;

    expect(state.settings.reviewers.at(-1)).toMatchObject({
        name: 'Docs',
        mode: { kind: 'on-trigger', trigger: { any: [{ target: 'path-glob', pattern: 'docs/**' }] } },
    });
    await pick('Docs review mode', 'Never');
    await save();
    await settle(() => button('General').click());
    await settle(() => button('Reviewers and models').click());
    await settle(() => button('Edit').click());
    await pick('Docs review mode', 'On trigger');
    expect(input('Rule 1 pattern').value).toBe('docs/**');
    await enter(input('Reviewer name'), 'Documentation');
    await enter($<HTMLTextAreaElement>('textarea')!, 'Check examples and links');
    await pick('Documentation reviewer model', 'Codex Model A');
    await save();
    expect(state.settings.reviewers.at(-1)!.id).toBe(id);
    expect(state.settings.reviewers.at(-1)!.revisions).toHaveLength(2);
    expect(state.settings.roles[`reviewer:${id}`]?.model?.model).toBe('model-a');
    await settle(() => button('Delete').click());
    await save();
    expect(state.settings.reviewers).toHaveLength(4);
    expect(state.settings.roles[`reviewer:${id}`]).toBeUndefined();
});

test('keeps failed drafts and saves kind/role choices with independent inheritance', async () => {
    await open();
    await pick('Build model', 'Codex Model A');
    await pick('Build effort', 'High');
    await pick('CI fixer effort', 'High');
    failSave = true;
    await save();
    expect(text(document.body)).toContain('Settings changed in another window.');
    expect(text($('[aria-label="Build model"]')!)).toContain('Model A');
    failSave = false;
    await save();
    expect(state.settings.threadKinds.build).toEqual({
        model: { instanceId: 'codex', model: 'model-a' },
        effort: 'high',
    });
    expect(state.settings.roles['ci-fixer']).toEqual({ effort: 'high' });
    await pick('CI fixer effort', 'Same as its thread');
    await save();
    expect(state.settings.roles['ci-fixer']).toEqual({});
});

test('saved options missing from T3 stay visible and are not substituted', async () => {
    await open();
    await settle(() => button('General').click());
    state.settings.threadKinds.shaping = { model: { instanceId: 'missing', model: 'old-model' }, effort: 'ultra' };
    await settle(() => button('Reviewers and models').click());
    expect(text(document.body)).toContain('missing old-model (not offered)');
    expect(text(document.body)).toContain('ultra (not offered)');
});
