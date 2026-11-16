// Settings' Labels section lists the tracker's labels and changes them in place, reading only the capability description.

import { effectiveVocabulary, type BoardData, type RepositorySetup, type TrackerLabel } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

const GITHUB = 'team/app';

const SETUP: RepositorySetup = {
    repo: GITHUB,
    role: '',
    itemSource: { kind: 'issues' },
    labels: ['saved custom label'],
    domainDocs: { kind: 'off' },
    skills: [],
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
    structureSync: true,
    sources: {
        createIssuesFromAddItem: 'default',
        createIssuesFromRetro: 'default',
        writeRefinedSpec: 'default',
        role: 'default',
        itemSource: 'default',
        labels: 'local',
        domainDocs: 'default',
        skills: 'default',
        vocabulary: 'default',
    },
};

const boardWith = (change: Partial<RepositorySetup> = {}, items = sample.items): BoardData => ({
    ...sample,
    items,
    repos: [{ ...sample.repos[0]!, repo: change.repo ?? GITHUB, setup: { ...SETUP, ...change } }, sample.repos[1]!],
});

/** Serves `board`, with the tracker's `labels` changing as the section's writes ask. `fail` answers a call with an error instead. */
function serve(
    board: BoardData,
    labels: TrackerLabel[],
    fail: (body: Record<string, unknown>) => string | undefined = () => undefined,
) {
    const tracker = { labels, sent: [] as Record<string, unknown>[] };

    fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
        if (url === '/api/repositories/settings')
            return new Response(
                JSON.stringify({
                    discovery: {
                        provider: 'github',
                        types: { state: 'available', choices: [] },
                        labels: { state: 'available', choices: tracker.labels.map((l) => l.name) },
                    },
                    error: null,
                }),
            );

        if (url !== '/api/repositories/labels') return new Response(JSON.stringify(board));

        const body = JSON.parse(init?.body as string) as Record<string, unknown> & {
            name: string;
            update: Partial<TrackerLabel>;
        };

        tracker.sent.push(body);

        const error = fail(body);

        if (error) return new Response(JSON.stringify({ error }), { status: 400 });

        if (body.change === 'list') return new Response(JSON.stringify({ labels: tracker.labels, error: null }));

        if (body.change === 'create') tracker.labels = [...tracker.labels, { name: body.name }];

        if (body.change === 'update')
            tracker.labels = tracker.labels.map((l) => (l.name === body.name ? { ...l, ...body.update } : l));

        if (body.change === 'delete') tracker.labels = tracker.labels.filter((l) => l.name !== body.name);

        return new Response(JSON.stringify({ board, error: null }));
    }) as typeof fetchMock);

    return tracker;
}

const section = () => $('[data-project-page] [data-labels]')!;
const rowOf = (name: string) => section().querySelector<HTMLElement>(`[data-label="${name}"]`);
const names = () => [...section().querySelectorAll('[data-label]')].map((row) => row.getAttribute('data-label'));
const buttonIn = (el: Element, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => text(b) === label || b.getAttribute('aria-label') === label,
    );
const creating = () => section().querySelector<HTMLInputElement>('[data-new-label]')!;
const confirmDelete = () => $('[data-delete-label]')!;
/** Settings' footer's Save changes, which saves an open label editor. */
const footerSave = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-settings-footer] button')].find(
        (b) => text(b) === 'Save changes',
    );

async function type(into: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
    await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

async function openEdit(board: BoardData): Promise<void> {
    await mountPage(board);
    await openDialog(board);
}

async function openDialog(board: BoardData): Promise<void> {
    await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
    await settle(() =>
        $$<HTMLButtonElement>('[data-settings-nav] button')
            .find((b) => text(b) === 'Projects')!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() =>
        $(`.settings-row[data-row="repo-${board.repos[0]!.repo}"]`)!
            .querySelector<HTMLButtonElement>('[data-settings-row-open]')!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
}

test('create writes to the tracker, refreshes from it and refuses a managed name with the reason', async () => {
    const board = boardWith();
    const tracker = serve(board, [{ name: 'docs' }]);

    await openEdit(board);
    await type(creating(), 'linked-work');
    expect(text(section())).toContain('linked-work is reserved for the factory’s saved links.');
    expect(buttonIn(section(), 'Create label')!.disabled).toBe(true);
    await type(creating(), 'area-ui');
    await settle(() => buttonIn(section(), 'Create label')!.click());
    expect(tracker.sent).toContainEqual({ repo: GITHUB, change: 'create', name: 'area-ui' });
    expect(names()).toEqual(['area-ui', 'docs']);
    expect(creating().value).toBe('');
});

test('rename, colour and description open in the row and send only what changed', async () => {
    const board = boardWith();
    const tracker = serve(board, [{ name: 'docs', color: 'ff0000', description: 'Writing' }]);

    await openEdit(board);
    await settle(() => buttonIn(rowOf('docs')!, 'Edit docs')!.click());
    await type(section().querySelector<HTMLInputElement>('[aria-label="Label name"]')!, 'status-done');
    expect(text(section())).toContain('status-done is reserved for board status.');
    expect(footerSave()!.disabled).toBe(true);
    await type(section().querySelector<HTMLInputElement>('[aria-label="Label name"]')!, 'guides');
    await settle(() => buttonIn(rowOf('docs')!, 'Colour #1D76DB')!.click());
    await settle(() => footerSave()!.click());
    expect(tracker.sent).toContainEqual({
        repo: GITHUB,
        change: 'update',
        name: 'docs',
        update: { name: 'guides', color: '1D76DB' },
    });
    expect(names()).toEqual(['guides']);
    expect(section().querySelector('[aria-label="Label name"]')).toBeNull();
});

test('delete asks first and states what it removes', async () => {
    const board = boardWith();
    const tracker = serve(board, [{ name: 'docs' }, { name: 'area-ui' }]);

    await openEdit(board);
    await settle(() => buttonIn(rowOf('docs')!, 'Delete docs')!.click());
    expect(tracker.sent.some((body) => body.change === 'delete')).toBe(false);
    expect(text(confirmDelete())).toContain('Delete label "docs"?');
    expect(text(confirmDelete())).toContain('This removes it from every ticket.');
    await settle(() => buttonIn(confirmDelete(), 'Cancel')!.click());
    expect($('[data-delete-label]')).toBeNull();
    await settle(() => buttonIn(rowOf('docs')!, 'Delete docs')!.click());
    await settle(() => buttonIn(confirmDelete(), 'Delete label')!.click());
    expect(tracker.sent).toContainEqual({ repo: GITHUB, change: 'delete', name: 'docs' });
    expect(names()).toEqual(['area-ui']);
    expect($('[data-delete-label]')).toBeNull();
});

test('without management access the section is read-only and states the reason', async () => {
    const board = boardWith({ access: { ...SETUP.access, 'manage-labels': 'refused' } });
    const tracker = serve(board, [{ name: 'docs' }]);

    await openEdit(board);
    expect(text(section())).toContain('Access to Manage labels was refused.');
    expect(creating().disabled).toBe(true);
    expect(buttonIn(section(), 'Create label')!.disabled).toBe(true);
    expect(buttonIn(rowOf('docs')!, 'Edit docs')!.disabled).toBe(true);
    expect(buttonIn(rowOf('docs')!, 'Delete docs')!.disabled).toBe(true);
    expect(tracker.sent.every((body) => body.change === 'list')).toBe(true);
});
