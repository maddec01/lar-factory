// The notices for a missing t3, a gh that's missing, logged out, or too old, or a missing git, jq or curl, and their Recheck.
// Ported from the tool notice cases of test/render.test.ts and its saved copies.

import type { BoardData, ToolChecks } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, warningText, fetchMock, mountPage, push, sample, settle, toolChecks } from '@/test/PageTest';

const withTools = (failed: Partial<ToolChecks>, fields: Partial<BoardData> = {}): BoardData => ({
    ...sample,
    tools: toolChecks(failed),
    ...fields,
});
const failed = { error: 'gh api graphql failed: HTTP 401' };
const recheckButton = () => $<HTMLButtonElement>('[data-recheck]')!;
const note = () => $('[data-recheck-note]');
const rechecks = () => fetchMock.mock.calls.filter(([url]) => url === '/api/recheck');

/** The next POST waits until the test answers it, so Checking… can be seen. */
let answer: (response: Response | Error) => Promise<void>;

function holdRecheck(): void {
    fetchMock.mockImplementation(async (url: string) => {
        if (url !== '/api/recheck') return new Response(JSON.stringify(sample));

        return new Promise<Response>((resolve, reject) => {
            answer = (response) => settle(() => (response instanceof Error ? reject(response) : resolve(response)));
        });
    });
}

const board = (data: BoardData) => new Response(JSON.stringify({ error: null, board: data }));

test('a missing t3 replaces the main area with a notice and Recheck', async () => {
    await mountPage(withTools({ t3: { result: 'missing' } }));

    const notice = $('main .tool-missing .tool-missing-box')!;

    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.querySelector('h1')!.textContent).toBe('T3 Code not found');
    expect(notice.querySelector('.lar-brand-mark')!.getAttribute('aria-label')).toBe('Lar');
    expect(notice.querySelector('p')!.textContent).toBe(
        'The board starts threads through T3 Code’s t3 command and didn’t find it on the login shell’s PATH, ' +
            'in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck. The board also looks again every 10 seconds.',
    );
    expect(recheckButton().textContent).toBe('Recheck');
    expect($('.desk'), 'the notice replaces the desk and the line').toBeNull();
    expect($('.line')).toBeNull();
    expect($('[data-warning]')).toBeNull();
});

test('a missing or logged-out gh shows its own notice, and other read failures show none', async () => {
    await mountPage(withTools({ gh: { result: 'missing', fix: 'brew install gh' } }, failed));

    const warnings = () => $$('[data-slot="notice"]');

    expect(warnings().length).toBe(1);
    expect(warnings()[0]!.closest('[data-slot="toaster"]')).toBeNull();
    expect(warningText(warnings()[0]!)).toEqual([
        'GitHub CLI not found.',
        'The board reads GitHub through gh. Install it with brew install gh Copy, ' +
            'then press Recheck. The board also looks again every 10 seconds. Recheck',
    ]);
    expect(warnings()[0]!.closest('[data-board-notices]')).not.toBeNull();
    expect(
        warnings()[0]!.querySelector('button[data-slot="button"]:not([data-recheck])')!.getAttribute('aria-label'),
    ).toBe('Copy brew install gh');

    await push(withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } }, failed));
    expect(warnings().length).toBe(1);
    expect(warningText(warnings()[0]!)).toEqual([
        'GitHub CLI is logged out.',
        'The board reads GitHub through gh. Run gh auth login Copy in a terminal, ' +
            'then press Recheck. The board also looks again every 10 seconds. Recheck',
    ]);

    await push(withTools({ gh: { result: 'missing', override: 'GH_PATH=/nowhere/gh', fix: 'brew install gh' } }));
    expect(warnings()[0]!.textContent).toContain(
        'No runnable gh is at GH_PATH=/nowhere/gh. Point GH_PATH at gh or unset it, then press Recheck.',
    );

    await push(withTools({}, failed));
    expect(warnings(), 'a failed read is the title bar’s to show').toEqual([]);
});

test('Recheck posts, shows Checking…, then the board once the tool is found, and keeps focus', async () => {
    holdRecheck();
    await mountPage(withTools({ t3: { result: 'missing' } }));
    recheckButton().focus();
    await settle(() => recheckButton().click());
    expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Checking…', true]);
    await settle(() => recheckButton().click());
    expect(rechecks().length, 'one Recheck at a time').toBe(1);
    expect(note(), 'nothing while checking').toBeNull();

    await answer(board(withTools({ t3: { result: 'missing' } })));
    expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Recheck', false]);
    expect([note()!.getAttribute('role'), note()!.textContent]).toEqual(['status', 'Still not found.']);
    expect(document.activeElement, 'focus goes back to Recheck').toBe(recheckButton());

    await settle(() => recheckButton().click());
    await answer(board(withTools({})));
    expect($('.tool-missing')).toBeNull();
    expect($('.desk')).not.toBeNull();
});

test('after Recheck a gh warning says it’s still logged out, or why Recheck failed, until the server answers again', async () => {
    holdRecheck();

    const loggedOut = withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } });

    await mountPage(loggedOut);
    expect(note(), 'nothing before a Recheck').toBeNull();
    await settle(() => recheckButton().click());
    await answer(board(loggedOut));
    expect(note()!.textContent).toBe('Still logged out.');
    await push(loggedOut);
    expect(note()!.textContent, 'stays across polls while gh is still logged out').toBe('Still logged out.');

    await settle(() => recheckButton().click());
    await answer(new TypeError('Failed to fetch'));
    expect(note()!.textContent).toBe('Can’t reach the board server. Try again.');
    await push(loggedOut);
    expect(note(), 'gone once the server answers again').toBeNull();
});

test('a Recheck note answers only the tool problems it found, and goes once they change', async () => {
    holdRecheck();

    const loggedOut = withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } });

    await mountPage(loggedOut);
    await settle(() => recheckButton().click());
    await answer(board(loggedOut));
    expect(note()!.textContent).toBe('Still logged out.');

    await push(withTools({ gh: { result: 'missing', fix: 'brew install gh' } }));
    expect(note(), 'a different problem isn’t what Recheck answered').toBeNull();
    await push(withTools({}));
    await push(loggedOut);
    expect(recheckButton()).not.toBeNull();
    expect(note(), 'a gh that logs out again opens a warning without the note').toBeNull();
});
