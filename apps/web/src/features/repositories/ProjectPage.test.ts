// Repository Settings save local choices and show effective issue defaults with verified Access.

import { effectiveVocabulary, type BoardData, type RepositorySetup } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, chooseOption, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

const REPO = 'team/app';

const SETUP: RepositorySetup = {
    repo: REPO,
    role: 'Backend API server',
    itemSource: { kind: 'issues' },
    labels: ['area: server'],
    domainDocs: { kind: 'off' },
    skills: [],
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
const dialog = () => $('[data-project-page]');
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
    await settle(() => buttonIn(row(), 'Open Project')!.click());
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

async function blur(input: HTMLInputElement) {
    await settle(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

async function picker(key = 'bug') {
    await settle(() => pickButton(key).click());
    await settle(() => vi.advanceTimersByTime(50));

    return $(`[data-label-picker="${key}"]`)!;
}

test('Projects opens a long page with a back link and no Edit dialog or publication notice', async () => {
    serve(boardWith());
    await openEdit(boardWith());
    expect($('[data-edit-dialog]')).toBeNull();
    expect(text(dialog())).not.toContain('Legacy structural publication');
    expect(setting('role').querySelector<HTMLInputElement>('input')!.value).toBe('Backend API server');
    await settle(() =>
        $$<HTMLButtonElement>('[data-settings-body] button')
            .find((button) => text(button) === '← Projects')!
            .click(),
    );
    expect(dialog()).toBeNull();
    expect(text($('[data-settings-body]'))).toContain('Settings stay on this machine.');
});

test('text saves on blur and an error remains beside its field with the typed value', async () => {
    const sent = serve(boardWith(), () => ({ status: 403, body: { error: 'Skills refused.' } }));

    await openEdit(boardWith());

    const input = setting('skills').querySelector<HTMLInputElement>('input')!;

    await type(input, 'testing, typing');
    expect(sent).toHaveLength(0);
    await blur(input);
    expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'skills', value: ['testing', 'typing'] }]);
    expect(text(setting('skills'))).toContain('Skills refused.');
    expect(text(setting('role'))).not.toContain('Skills refused.');
    expect(input.value).toBe('testing, typing');
    expect(buttonIn(setting('skills'), 'Save')).toBeUndefined();
});

test('closing Settings saves a text field even when no browser blur fires', async () => {
    const sent = serve(boardWith());

    await openEdit(boardWith());
    await type(setting('role').querySelector('input')!, 'New role');
    await settle(() => $<HTMLButtonElement>('[data-slot="modal-content"] [aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(100));
    expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'role', value: 'New role' }]);
});

test('a blank Team shows an error and sends no request', async () => {
    const repo = 'organization/project/repository';
    const board = boardWith({ repo, itemSource: { kind: 'azure-board', team: 'Platform' } });
    const sent = serve(board);

    await openRepositories(board);
    await settle(() => buttonIn($(`.settings-row[data-row="repo-${repo}"]`)!, 'Open Project')!.click());

    const input = setting('itemSource').querySelector<HTMLInputElement>('input')!;

    await type(input, ' ');
    await blur(input);
    expect(sent).toHaveLength(0);
    expect(text(setting('itemSource'))).toContain('Enter a Team.');
});

test('choices apply immediately and Reset retains its default behavior', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);
    await chooseOption(setting('domainDocs').querySelector('[role="combobox"]')!, 'Write in build PRs');
    expect(sent[0]).toEqual({
        repo: REPO,
        change: 'override',
        key: 'domainDocs',
        value: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' },
    });
    await settle(() => buttonIn(setting('role'), 'Reset')!.click());
    expect(sent.at(-1)).toEqual({ repo: REPO, change: 'override', key: 'role' });
});

test('all nine access operations share the same states and recheck performs a probe', async () => {
    const sent = serve(boardWith());

    await openEdit(boardWith());

    const access = $('[data-access]')!;

    expect(access.querySelectorAll('[data-operation]')).toHaveLength(9);
    expect(text(access)).toContain('Not checked');
    expect(text(access)).toContain('Allowed');
    expect(text(access)).toContain('Refused');
    await settle(() => buttonIn(access, 'Recheck access')!.click());
    expect(sent).toEqual([{ repo: REPO, change: 'recheck' }]);
});

test('access disables only issue options that need it and recheck restores stored preferences', async () => {
    const initial = boardWith();
    const final = boardWith({
        access: { ...SETUP.access, 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' },
        createIssuesFromRetro: false,
    });
    const sent = serve(initial, () => ({ body: { board: final } }));

    await openEdit(initial);
    expect(setting('createIssuesFromAddItem').querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    expect(text(setting('createIssuesFromAddItem'))).toContain('not checked');
    await settle(() => buttonIn($('[data-access]')!, 'Recheck access')!.click());
    expect(setting('createIssuesFromAddItem').querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe(
        'true',
    );
    expect(setting('createIssuesFromRetro').querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe(
        'false',
    );
    await settle(() => setting('writeRefinedSpec').querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(sent.at(-1)).toEqual({ repo: REPO, change: 'override', key: 'writeRefinedSpec', value: false });
});

test('domain docs requires branch and PR access and keeps its saved paths', async () => {
    const board = boardWith({
        domainDocs: { kind: 'repository', glossary: 'WORDS.md', adrs: 'decisions' },
        access: { ...SETUP.access, 'edit-ticket': 'allowed' },
    });

    serve(board);
    await openEdit(board);
    expect(setting('domainDocs').querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
    expect(setting('glossary').querySelector<HTMLInputElement>('input')!.value).toBe('WORDS.md');
    expect(text(setting('domainDocs'))).toContain('Open PRs');
});

test('a label search finds one of 150 choices by keyboard and saves the complete kind once on close', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);

    const popover = await picker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'label-149');
    expect(popover.querySelectorAll('[role="option"]')).toHaveLength(1);
    await settle(() =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    await type(input, 'triage');
    await settle(() =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    expect(sent).toHaveLength(0);
    await settle(() => buttonIn(popover, 'Done')!.click());
    expect(sent).toEqual([
        { repo: REPO, change: 'vocabulary', key: 'bug', value: { type: null, labels: ['label-149', 'triage'] } },
    ]);
});

test('typing a new label creates nothing and explicit Create preserves a failed draft', async () => {
    const board = allowed();
    const sent = serve(board, () => ({ status: 403, body: { error: 'Label creation refused.' } }));

    await openEdit(board);

    const popover = await picker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'needs review');
    expect(sent).toHaveLength(0);
    await settle(() => buttonIn(popover, 'Create "needs review"')!.click());
    expect(sent).toEqual([
        {
            repo: REPO,
            change: 'vocabulary',
            key: 'bug',
            value: { type: null, labels: [] },
            newLabels: ['needs review'],
        },
    ]);
    expect(text(vocabularyRow('bug'))).toContain('Label creation refused.');
    expect(text(vocabularyRow('bug'))).toContain('needs review');
    expect(input.value).toBe('needs review');
});

test('a type choice saves immediately while the suggested label stays optional', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);
    expect(text(vocabularyRow('bug'))).toContain('bug · suggested');
    await chooseOption(vocabularyRow('bug').querySelector('[role="combobox"]')!, 'Task');
    expect(sent).toEqual([{ repo: REPO, change: 'vocabulary', key: 'bug', value: { type: 'Task', labels: [] } }]);
});

test('forbidden and missing mappings stay visible and can be removed', async () => {
    const board = boardWith({ ...effectiveVocabulary({ bug: { type: 'Gone', labels: ['linked-work', 'removed'] } }) });
    const sent = serve(board);

    await openEdit(board);
    expect(text(vocabularyRow('bug'))).toContain('removed (unavailable)');
    await settle(() =>
        vocabularyRow('bug').querySelector<HTMLButtonElement>('[aria-label="Remove linked-work from Bug"]')!.click(),
    );
    expect(sent[0]).toMatchObject({ change: 'vocabulary', value: { type: 'Gone', labels: ['removed'] } });
});

test('closing a failed Create preserves its draft without repeating the request', async () => {
    const board = allowed();
    const sent = serve(board, () => ({ status: 403, body: { error: 'Create refused.' } }));

    await openEdit(board);

    const popover = await picker();

    await type(popover.querySelector('input')!, 'new-label');
    await settle(() => buttonIn(popover, 'Create "new-label"')!.click());
    await settle(() => buttonIn(popover, 'Done')!.click());
    expect(sent).toHaveLength(1);
    expect(text(vocabularyRow('bug'))).toContain('new-label');
    expect(text(vocabularyRow('bug'))).toContain('Create refused.');
});

test('an older kind save can refresh discovery without erasing another picker search', async () => {
    const board = allowed();

    serve(board);

    const serving = fetchMock.getMockImplementation() as unknown as (
        url: string,
        init?: RequestInit,
    ) => Promise<Response>;
    let finish!: (response: Response) => void;

    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
        if (url === '/api/repositories/settings' && JSON.parse(init?.body as string).change === 'vocabulary')
            return new Promise<Response>((resolve) => {
                finish = resolve;
            });

        return serving(url, init);
    }) as typeof fetchMock);
    await openEdit(board);
    await chooseOption(vocabularyRow('bug').querySelector('[role="combobox"]')!, 'Task');

    const popover = await picker('feature');
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'keep this text');
    await settle(() => finish(new Response('{}')));
    expect($<HTMLInputElement>('[data-label-picker="feature"] input')!.value).toBe('keep this text');
});

test('leaving the Project page closes a dirty label picker with one complete kind save', async () => {
    const board = allowed();
    const sent = serve(board);

    await openEdit(board);

    const popover = await picker();
    const input = popover.querySelector<HTMLInputElement>('input')!;

    await type(input, 'triage');
    await settle(() =>
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    expect(sent).toHaveLength(0);

    const { useSettingsStore } = await import('@/features/settings/SettingsStore');

    await settle(() => useSettingsStore.getState().setSection('general'));
    expect(sent).toEqual([{ repo: REPO, change: 'vocabulary', key: 'bug', value: { type: null, labels: ['triage'] } }]);
});
