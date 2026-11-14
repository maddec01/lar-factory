import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, push, sample, settle, stream, toolChecks, warningText } from '@/test/PageTest';

const healthy: BoardData = { ...sample, tools: toolChecks(), repositoryConfigProblems: [], itemSourceProblems: [] };
const warning = (key: string) => $(`[data-warning="${key}"]`)?.closest<HTMLElement>('[data-slot="notice"]') ?? null;
const closeWarning = (key: string) => settle(() => warning(key)!.querySelector<HTMLButtonElement>('.dismiss')!.click());

const conditions: { key: string; failed: Partial<BoardData>; changed: Partial<BoardData> }[] = [
    {
        key: 'local-work',
        failed: { localProblem: 'Restart Lar Factory to continue.' },
        changed: { localProblem: 'Restart Lar Factory to continue.' },
    },
    {
        key: 't3',
        failed: { tools: toolChecks({ t3: { result: 'not-running' } }) },
        changed: { tools: toolChecks({ t3: { result: 'not-running', version: '1.0.0' } }) },
    },
    {
        key: 'gh',
        failed: { tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) },
        changed: { tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' } }) },
    },
    ...(['git', 'jq', 'curl'] as const).map((name) => ({
        key: name,
        failed: { tools: toolChecks({ [name]: { result: 'missing', fix: `brew install ${name}` } }) },
        changed: {
            tools: toolChecks({
                [name]: {
                    result: 'missing',
                    fix: `brew install ${name}`,
                    override: `${name.toUpperCase()}_PATH=/missing/${name}`,
                },
            }),
        },
    })),
    {
        key: 'az',
        failed: { tools: toolChecks({ az: { result: 'missing', fix: 'brew install azure-cli' } }) },
        changed: { tools: toolChecks({ az: { result: 'logged-out', fix: 'az login' } }) },
    },
    {
        key: 'item-source:owner/repo',
        failed: { itemSourceProblems: [{ repo: 'owner/repo', problem: 'no source' }] },
        changed: { itemSourceProblems: [{ repo: 'Owner/Repo', problem: 'source unavailable' }] },
    },
];

test.each(conditions)(
    '$key stays closed through refreshes and changed details, then shows after clearing and recurring',
    async ({ key, failed, changed }) => {
        await mountPage({ ...healthy, ...failed });

        const entry = warning(key)!;

        expect(entry.dataset.slot).toBe('notice');
        expect(entry.querySelector('.dismiss')!.getAttribute('aria-label')).toMatch(/^Dismiss: .+/);
        await settle(() => stream().onopen!());
        await settle(() => vi.advanceTimersByTime(60_000));
        expect(warning(key)).toBe(entry);
        await push({ ...healthy, ...changed });
        expect(warning(key), 'changed details preserve the notification and its age').toBe(entry);
        await push(healthy);
        expect(warning(key)).toBeNull();
        await push({ ...healthy, ...failed });
        await closeWarning(key);
        expect(warning(key)).toBeNull();
        await push({ ...healthy, ...failed });
        await push({ ...healthy, ...changed });
        expect(warning(key)).toBeNull();
        await push(healthy);
        await push({ ...healthy, ...changed });
        expect(warning(key)).not.toBeNull();
    },
);

test.each(['empty', 'T3 Code missing'])(
    'server failures stay closed through changed details on the %s screen and recur after a successful read',
    async (screen) => {
        const data: BoardData = {
            ...healthy,
            error: null,
            repos: [],
            items: [],
            tools: toolChecks(screen === 'empty' ? {} : { t3: { result: 'missing' } }),
        };

        await mountPage(data);
        expect($(screen === 'empty' ? '[data-empty-state]' : '.tool-missing')).not.toBeNull();
        fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
        await settle(() => vi.advanceTimersByTime(15_000));
        expect(warningText(warning('client-error')!)).toEqual([
            'Board disconnected — showing last received data',
            'HTTP 502',
        ]);

        const entry = warning('client-error');

        fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
        await settle(() => vi.advanceTimersByTime(60_000));
        expect(warning('client-error')).toBe(entry);
        expect(warningText(entry!)[1]).toContain('HTTP 503');
        await settle(() => entry!.querySelector<HTMLElement>('.dismiss')!.focus());
        await closeWarning('client-error');
        // Neither screen has Add item in the title bar, so focus falls back to Settings.
        expect(document.activeElement).toBe($('.open-settings'));
        fetchMock.mockImplementation(async () => new Response('', { status: 504 }));
        await settle(() => vi.advanceTimersByTime(15_000));
        expect(warning('client-error')).toBeNull();
        fetchMock.mockImplementation(async () => new Response(JSON.stringify(data)));
        await settle(() => vi.advanceTimersByTime(15_000));
        expect(warning('client-error')).toBeNull();
        fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
        await settle(() => vi.advanceTimersByTime(15_000));
        expect(warning('client-error')).not.toBeNull();
    },
);

test('a successful Recheck restores a closed server warning as well as successful live reads', async () => {
    await mountPage({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    await settle(() => vi.advanceTimersByTime(15_000));
    await closeWarning('client-error');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null, board: healthy })));
    await settle(() => $<HTMLButtonElement>('[data-recheck]')!.click());
    expect(warning('gh')).toBeNull();
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
    await settle(() => vi.advanceTimersByTime(15_000));
    expect(warning('client-error')).not.toBeNull();
});

test('a closed tool warning stays closed across scope, empty state and T3 Code missing screen changes', async () => {
    const data: BoardData = { ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) };

    await mountPage(data);

    const { useScopeStore } = await import('@/features/filters/ScopeStore');

    await closeWarning('gh');
    await settle(() => useScopeStore.getState().setScope(sample.repos[0]!.repo));
    await push({ ...data, tools: { ...data.tools!, t3: { result: 'missing' } } });
    expect($('.tool-missing')).not.toBeNull();
    expect(warning('gh')).toBeNull();
    await push({ ...data, repos: [], items: [], error: null });
    expect($('[data-empty-state]')).not.toBeNull();
    expect(warning('gh')).toBeNull();
    await push({ ...healthy, repos: [], items: [], error: null });
    await push({ ...data, repos: [], items: [], error: null });
    expect(warning('gh')).not.toBeNull();
});

test('az coverage hides an item-source warning without clearing its dismissal', async () => {
    const data: BoardData = {
        ...healthy,
        itemSourceProblems: [{ repo: 'owner/repo', problem: 'logged out', fix: 'az login' }],
    };
    const covered: BoardData = { ...data, tools: toolChecks({ az: { result: 'logged-out', fix: 'az login' } }) };

    await mountPage(data);
    await closeWarning('item-source:owner/repo');
    await push(covered);
    expect(warning('az')).not.toBeNull();
    expect(warning('item-source:owner/repo')).toBeNull();
    await closeWarning('az');
    await push(data);
    expect(warning('item-source:owner/repo')).toBeNull();
    // A real clearing while covered still restores a later recurrence.
    await push({ ...covered, itemSourceProblems: [] });
    await push(covered);
    expect(warning('item-source:owner/repo')).toBeNull();
    await push(data);
    expect(warning('item-source:owner/repo')).not.toBeNull();
});

test.each(['item', 'settings'])('closing a focused warning keeps focus in the open %s dialog', async (kind) => {
    await mountPage({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });

    // Exercise the notification's focus fallback without the modal trap redirecting focus before close.
    const dialog = document.createElement('div');

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');

    if (kind === 'item') dialog.setAttribute('data-item-dialog', '');

    const close = document.createElement('button');

    close.setAttribute('data-slot', 'modal-close');
    close.textContent = 'Close';
    dialog.append(close);
    document.body.append(dialog);
    await settle(() => warning('gh')!.querySelector<HTMLElement>('.dismiss')!.focus());
    await closeWarning('gh');
    expect(dialog.contains(document.activeElement)).toBe(true);
});

test('while the page has lost the board, the notice shows uncollapsed, freshness stops reading as live, the desk adds no card, and recovery clears it all', async () => {
    const empty: BoardData = {
        ...healthy,
        error: null,
        fetchedAt: new Date(Date.now()).toISOString(),
        items: sample.items.filter((i) => i.status === 'Queued'),
    };

    await mountPage(empty);

    const freshness = () => $('.refreshed')!;
    const refreshed = () => $('.refreshed')!.textContent;

    expect($('.refreshed'), 'a live board shows no Refreshed light').toBeNull();
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    await settle(() => vi.advanceTimersByTime(15_000));

    const notice = warning('client-error')!;

    expect(warningText(notice)).toEqual(['Board disconnected — showing last received data', 'HTTP 502']);
    expect(notice.closest('ul')!.hasAttribute('data-folded'), 'not folded under the header').toBe(false);
    expect(freshness().dataset.health).toBe('disconnected');
    expect(refreshed()).toContain('Disconnected');
    expect($$('.desk-row')).toHaveLength(0);
    expect($('section.desk')!.textContent).toBe('Your desk0Nothing waited on you at the last read.');
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ ...empty, fetchedAt: new Date(Date.now()).toISOString() })),
    );
    await settle(() => vi.advanceTimersByTime(15_000));
    expect(warning('client-error')).toBeNull();
    expect($('[data-board-notices]')).toBeNull();
    expect($('.refreshed'), 'live again, the light goes').toBeNull();
    expect($('section.desk')!.textContent).toBe('Your desk0Nothing waits on you.');
});

test('closing the disconnected notice leaves the title bar saying Disconnected until the board recovers', async () => {
    const empty: BoardData = { ...healthy, error: null, fetchedAt: new Date(Date.now()).toISOString(), items: [] };

    await mountPage(empty);

    const refreshed = () => $('.refreshed')!.textContent;

    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    await settle(() => vi.advanceTimersByTime(15_000));
    await closeWarning('client-error');
    expect(warning('client-error')).toBeNull();
    await settle(() => vi.advanceTimersByTime(15_000));
    expect(warning('client-error'), 'stays closed while the board is still gone').toBeNull();
    expect(refreshed()).toContain('Disconnected');
    expect($('.refreshed')!.dataset.health).toBe('disconnected');
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ ...empty, fetchedAt: new Date(Date.now()).toISOString() })),
    );
    await settle(() => vi.advanceTimersByTime(15_000));
    expect($('.refreshed'), 'live again, the light goes').toBeNull();
});
