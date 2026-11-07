// Settings › General: the choice for an item's shaping threads after Start build, which posts to the board server and
// shows the board it answers with.

import type { BoardData, ShapingThreadCleanupState } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, fetchMock, mountPage, chooseOption, openOptions, sample, settle, text } from '../../test/support.ts';

const row = () => $('.settings-row[data-row="shaping-thread-cleanup"]')!;
const select = () => $('[data-shaping-thread-cleanup] [role="combobox"]')!;
const pick = (value: string) => chooseOption(select(), value[0]!.toUpperCase() + value.slice(1));
const picked = () => (text(select()) === 'Choose' ? [] : [text(select()).toLowerCase()]);
const posted = () =>
    fetchMock.mock.calls
        .filter(([url]) => url === '/api/shaping-thread-cleanup')
        .map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withChoice = (state?: ShapingThreadCleanupState): BoardData => ({
    ...sample,
    ...(state && { shapingThreadCleanup: state }),
});

async function openGeneral(data: BoardData): Promise<void> {
    fetchMock.mockImplementation((async () => new Response(JSON.stringify(data))) as never);
    await mountPage(data);
    await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
    await settle(() => vi.advanceTimersByTime(50));
}

/** Answers a POST of the setting with `status` and `body`. */
function answerSave(status: number, body: object): void {
    fetchMock.mockImplementation((async () => new Response(JSON.stringify(body), { status })) as never);
}

test('General has the row in its own group, with the four choices and what each does', async () => {
    await openGeneral(withChoice({ choice: 'archive' }));

    const group = row().closest('section')!;

    expect(group.querySelectorAll('.settings-row')).toHaveLength(1);
    expect(text(row().querySelector('.settings-row-title'))).toBe('Shaping threads after Start build');
    expect(await openOptions(select())).toEqual(['Keep', 'Settle', 'Archive', 'Delete']);
    await settle(() =>
        $('[role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    await settle(() => row().querySelector<HTMLButtonElement>('[aria-label^="About"]')!.click());
    expect(picked()).toEqual(['archive']);

    const description = text(document.querySelector('[data-help-text]'));

    for (const said of [
        'Keep changes nothing',
        'Item details still links to a settled thread',
        "An archived thread has no link on the board and reopens from T3's Settings, Archived",
        "Delete can't be undone from the board",
        "item's stats no longer count",
    ])
        expect(description).toContain(said);
});

test('Picking a choice saves it and shows the board the server answers with', async () => {
    await openGeneral(withChoice({ choice: 'archive' }));
    answerSave(200, { error: null, board: withChoice({ choice: 'delete' }) });
    await pick('delete');
    expect(posted()).toEqual([{ choice: 'delete' }]);
    expect(picked()).toEqual(['delete']);
    expect($('[data-shaping-thread-cleanup] [role="alert"]')).toBeNull();
});

test('A refused save shows why and keeps the saved choice', async () => {
    await openGeneral(withChoice());
    expect(picked(), 'sample mode has no choice to show').toEqual([]);
    answerSave(403, { error: 'Shaping thread cleanup is disabled in sample mode.' });
    await pick('keep');
    expect(picked()).toEqual([]);
    expect(text($('[data-shaping-thread-cleanup] [role="alert"]'))).toBe(
        'Shaping thread cleanup is disabled in sample mode.',
    );
});

test('An unreadable setting shows why, and saving a choice clears it', async () => {
    const problem = "The shaping thread cleanup setting /data/shaping-thread-cleanup.json isn't JSON: bad.";

    await openGeneral(withChoice({ problem }));
    expect(picked()).toEqual([]);
    expect(text($('[data-shaping-thread-cleanup] [role="alert"]'))).toBe(
        `${problem} Saving a choice replaces the file.`,
    );
    answerSave(200, { error: null, board: withChoice({ choice: 'settle' }) });
    await pick('settle');
    expect(picked()).toEqual(['settle']);
    expect($('[data-shaping-thread-cleanup] [role="alert"]')).toBeNull();
});
