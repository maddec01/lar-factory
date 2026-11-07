import type { RepositorySetup, VocabularyTerm } from '@lar-factory/shared';
import type { VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, chooseOption, settle, text } from '@/test/PageTest';

const setup = {
    repo: 'team/app',
    access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed', 'manage-labels': 'allowed' },
} as RepositorySetup;
const discovery: VocabularyDiscovery = {
    provider: 'github',
    types: { state: 'available', choices: [] },
    labels: { state: 'available', choices: [] },
};

async function render(
    change: { setup?: RepositorySetup; discovery?: VocabularyDiscovery; value?: VocabularyTerm } = {},
) {
    const { VocabularyFields } = await import('./VocabularyEditor');
    const recheck = vi.fn();
    const changed = vi.fn();

    function Draft() {
        const [value, setValue] = useState<VocabularyTerm>(change.value ?? { type: null, labels: [] });
        const [newLabels, setNewLabels] = useState<string[]>([]);

        return createElement(VocabularyFields, {
            name: 'bug',
            setup: change.setup ?? setup,
            discovery: change.discovery ?? discovery,
            value,
            newLabels,
            onRecheck: recheck,
            onChange: (term: VocabularyTerm, labels: string[]) => {
                changed(term, labels);
                setValue(term);
                setNewLabels(labels);
            },
        });
    }

    document.body.replaceChildren();

    const host = document.body.appendChild(document.createElement('div'));

    await settle(() => createRoot(host).render(createElement(Draft)));

    return { recheck, changed };
}

async function picker() {
    await settle(() => $<HTMLButtonElement>('[aria-label^="Choose Bug"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));

    return $('[data-label-picker]')!;
}

async function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

test('onboarding creates a draft only after an explicit choice, without writing', async () => {
    const { changed } = await render();
    const popover = await picker();

    await type(popover.querySelector('input')!, 'needs-review');
    expect(changed).not.toHaveBeenCalled();
    await settle(() =>
        [...popover.querySelectorAll('button')]
            .find((button) => text(button) === 'Create "needs-review" when you add the Project')!
            .click(),
    );
    expect(changed).toHaveBeenLastCalledWith({ type: null, labels: [] }, ['needs-review']);
    expect(text($('[data-vocabulary]'))).toContain('needs-review (new)');
});

test('no issue types disables the type control without a futile Recheck', async () => {
    await render({
        discovery: { ...discovery, types: { state: 'unsupported', reason: 'This Project has no issue types.' } },
    });
    expect($<HTMLButtonElement>('[aria-label="Bug type"]')!.disabled).toBe(true);
    expect(text(document.body)).toContain('This Project has no issue types.');
    expect($$<HTMLButtonElement>('button').some((button) => text(button) === 'Recheck')).toBe(false);
});

test('Azure uses work item types and tags and excludes repository routing tags', async () => {
    const { changed } = await render({
        setup: { ...setup, repo: 'org/project/repository' },
        discovery: {
            provider: 'azure',
            types: { state: 'available', choices: ['Defect'] },
            labels: { state: 'available', choices: ['docs', 'repo-repository'] },
        },
    });

    await chooseOption($('[aria-label="Bug type"]')!, 'Defect');
    expect(changed).toHaveBeenLastCalledWith({ type: 'Defect', labels: [] }, []);

    const popover = await picker();

    expect([...popover.querySelectorAll('[data-label-choice]')].map(text)).toEqual(['docs']);
    await type(popover.querySelector('input')!, 'brand-new');

    const create = [...popover.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        text(button).startsWith('Create'),
    )!;

    expect(create).toBeUndefined();
    expect(text(popover)).toContain('Azure DevOps has no way to create a tag on its own.');
});

test('refused metadata keeps mapped names and permits removing them', async () => {
    await render({
        setup: { ...setup, access: { ...setup.access, 'tag-ticket': 'refused' } },
        value: { type: null, labels: ['bug'] },
        discovery: { ...discovery, labels: { state: 'refused', reason: 'Metadata read denied.' } },
    });
    expect(text(document.body)).toContain('Metadata read denied.');
    expect(text(document.body)).not.toContain('bug (unavailable)');
    await settle(() => $<HTMLButtonElement>('[aria-label="Remove bug from Bug"]')!.click());
    expect(text($('[data-vocabulary]'))).not.toContain('bug');
});

test('an empty type list does not offer Recheck for an operation no type can use', async () => {
    await render({ setup: { ...setup, access: { ...setup.access, 'type-ticket': 'unverified' } } });
    expect($<HTMLButtonElement>('[aria-label="Bug type"]')!.disabled).toBe(true);
    expect(text(document.body)).toContain('This Project has no issue types.');
    expect($$<HTMLButtonElement>('button').some((button) => text(button) === 'Recheck')).toBe(false);
});
