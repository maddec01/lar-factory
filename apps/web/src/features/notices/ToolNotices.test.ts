// A missing tool's notice and its Recheck.

import type { BoardData, ToolChecks } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, fetchMock, mountPage, sample, settle, toolChecks } from '@/test/PageTest';

const withTools = (failed: Partial<ToolChecks>): BoardData => ({ ...sample, tools: toolChecks(failed) });
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
