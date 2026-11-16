// Repository Settings save local choices and show effective issue defaults with verified Access.

import { effectiveVocabulary, type BoardData, type RepositorySetup } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

const REPO = 'team/app';

const SETUP: RepositorySetup = {
    repo: REPO,
    role: 'Backend API server',
    itemSource: { kind: 'issues' },
    labels: ['area: server'],
    domainDocs: { kind: 'off' },
    skills: [],
    buildMethod: 'tdd',
    ...effectiveVocabulary(),
    access: {
        'push-branch': 'allowed',
        'open-pr': 'unverified',
        'publish-ticket': 'unverified',
        'edit-ticket': 'refused',
        'tag-ticket': 'refused',
        'manage-labels': 'unverified',
        'comment-ticket': 'unverified',
        'type-ticket': 'unverified',
        'relate-ticket': 'unverified',
    },
    structureSync: true,
    sources: {
        createIssuesFromAddItem: 'default',
        createIssuesFromRetro: 'default',
        writeRefinedSpec: 'default',
        role: 'local',
        itemSource: 'default',
        labels: 'local',
        domainDocs: 'default',
        skills: 'default',
        buildMethod: 'default',
        vocabulary: 'default',
    },
};

/** The sample board with a generic repository's setup. */
function boardWith(change: Partial<RepositorySetup> = {}, items = sample.items): BoardData {
    return {
        ...sample,
        items,
        repos: [{ ...sample.repos[0]!, repo: change.repo ?? REPO, setup: { ...SETUP, ...change } }, sample.repos[1]!],
    };
}

/** Serves `board`, and `answer` for each settings change, whose bodies it returns. */
function serve(
    board: BoardData,
    answer: (body: Record<string, unknown>) => { status?: number; body: object } = () => ({
        body: { board, error: null },
    }),
) {
    const sent: Record<string, unknown>[] = [];

    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
        if (url === '/api/repositories/labels') return new Response(JSON.stringify({ labels: [] }));

        if (url !== '/api/repositories/settings') return new Response(JSON.stringify(board));

        const body = JSON.parse(init?.body as string) as Record<string, unknown>;

        if (body.change === 'discover-vocabulary') return new Response(JSON.stringify({ discovery }));

        sent.push(body);

        const reply = answer(body);

        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }) as typeof fetchMock);

    return sent;
}

const row = () => $(`.settings-row[data-row="repo-${REPO}"]`)!;
const setting = (key: string) => $(`[data-project-page] [data-setting="${key}"]`)!;
const buttonIn = (el: Element, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button:not([role="combobox"])')].find((b) => text(b) === label);

async function type(into: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
    await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

async function openRepositories(board: BoardData): Promise<void> {
    await mountPage(board);
    await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
    await settle(() =>
        $$<HTMLButtonElement>('[data-settings-nav] button')
            .find((b) => text(b) === 'Projects')!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
}

async function openEdit(board: BoardData): Promise<void> {
    await openRepositories(board);
    await settle(() => row().querySelector<HTMLButtonElement>('[data-settings-row-open]')!.click());
}

const discovery = {
    provider: 'github',
    types: { state: 'available', choices: ['Task'] },
    labels: {
        state: 'available',
        choices: ['bug', 'triage', ...Array.from({ length: 150 }, (_, index) => `label-${index}`)],
    },
};
const allowed = () =>
    boardWith({
        access: Object.fromEntries(
            Object.keys(SETUP.access).map((key) => [key, 'allowed']),
        ) as RepositorySetup['access'],
    });
const vocabularyRow = (key: string) => $(`[data-vocabulary="${key}"]`)!;
const pickButton = (key: string) =>
    vocabularyRow(key).querySelector<HTMLButtonElement>(
        `[aria-label="Choose ${key[0]!.toUpperCase() + key.slice(1)} labels"]`,
    )!;

/** A button in Settings' footer, such as Save changes. */
const footerButton = (label: string) =>
    $$<HTMLButtonElement>('[data-settings-footer] button').find((b) => text(b) === label);

async function blur(input: HTMLInputElement) {
    await settle(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

async function picker(key = 'bug') {
    await settle(() => pickButton(key).click());
    await settle(() => vi.advanceTimersByTime(50));

    return $(`[data-label-picker="${key}"]`)!.closest('[data-slot="popover-content"]')!;
}

test('typed text is a draft the footer saves, and an error remains beside its field with the typed value', async () => {
    const sent = serve(boardWith(), () => ({ status: 403, body: { error: 'Skills refused.' } }));

    await openEdit(boardWith());

    const input = setting('skills').querySelector<HTMLInputElement>('input')!;

    await type(input, 'testing, typing');
    await blur(input);
    expect(sent, 'leaving the field saves nothing').toHaveLength(0);
    expect(buttonIn(setting('skills'), 'Save'), 'no Save of its own').toBeUndefined();
    await settle(() => footerButton('Save changes')!.click());
    expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'skills', value: ['testing', 'typing'] }]);
    expect(text(setting('skills'))).toContain('Skills refused.');
    expect(text(setting('role'))).not.toContain('Skills refused.');
    expect(input.value).toBe('testing, typing');
    expect(footerButton('Save changes'), 'the draft stays').toBeDefined();
});

test('closing Settings with typed text asks first, and discarding sends nothing', async () => {
    const sent = serve(boardWith());

    await openEdit(boardWith());
    await type(setting('role').querySelector('input')!, 'New role');
    await settle(() => $<HTMLButtonElement>('[data-slot="modal-content"] [aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(100));
    expect(text($('[role="alertdialog"]'))).toContain('Discard changes?');
    await settle(() =>
        [...$('[role="alertdialog"]')!.querySelectorAll('button')].find((b) => text(b) === 'Discard changes')!.click(),
    );
    await settle(() => vi.advanceTimersByTime(100));
    expect(sent).toEqual([]);
    expect($('[data-project-page]')).toBeNull();
});

test('a label search finds one of 150 choices with checkboxes and saves the complete kind once on close', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);

    const popover = await picker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'label-149');
    expect(popover.querySelectorAll('[data-label-choice]')).toHaveLength(1);
    await settle(() => popover.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await type(input, 'triage');
    await settle(() => popover.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(sent).toHaveLength(0);
    await settle(() => buttonIn(popover, 'Done')!.click());
    expect(sent).toEqual([
        { repo: REPO, change: 'vocabulary', key: 'bug', value: { type: null, labels: ['label-149', 'triage'] } },
    ]);
});

test('leaving the project page closes a dirty label picker with one complete kind save', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);

    const popover = await picker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'triage');
    await settle(() => popover.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(sent).toHaveLength(0);

    const { useSettingsStore } = await import('@/features/settings/SettingsStore');

    await settle(() => useSettingsStore.getState().setSection('general'));
    expect(sent).toEqual([{ repo: REPO, change: 'vocabulary', key: 'bug', value: { type: null, labels: ['triage'] } }]);
});
