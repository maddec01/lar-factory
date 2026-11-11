// Settings › General: the heavy command limit and the automatic build limit, each Automatic (applied at once) or a typed
// whole number from 1 (a draft Settings' footer saves), which posts to the board server and shows the board it answers
// with.

import type { BoardData, BuildLimitState, HeavyCommandLimitState } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, openOptions, sample, settle, text } from '@/test/PageTest';

const row = () => $('.settings-row[data-row="heavy-command-limit"]')!;
const select = (name = 'heavy-command-limit') => $(`[data-limit="${name}"] [role="combobox"]`)!;
const pick = async (value: string, name = 'heavy-command-limit') => {
    await openOptions(select(name));
    await settle(() =>
        $$('[role="option"]')
            .find((option) => (value === 'number' ? text(option) === 'Number' : text(option).startsWith('Automatic')))!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
};
const picked = (name?: string) =>
    text(select(name)) === 'Number' ? ['number'] : text(select(name)).startsWith('Automatic') ? ['automatic'] : [];
const input = () => $<HTMLInputElement>('[data-limit="heavy-command-limit"] input[aria-label="Heavy command limit"]');
/** Settings' footer's Save changes, which saves the typed limit. */
const saveButton = () =>
    $$<HTMLButtonElement>('[data-settings-footer] button').find((b) => text(b) === 'Save changes')!;
const alerts = (name = 'heavy-command-limit') => $$(`[data-limit="${name}"] [role="alert"]`).map(text);
const posted = (name = 'heavy-command-limit') =>
    fetchMock.mock.calls
        .filter(([url]) => url === `/api/${name}`)
        .map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withLimit = (state?: HeavyCommandLimitState, build?: BuildLimitState): BoardData => ({
    ...sample,
    heavyCommandLimit: state,
    buildLimit: build,
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

async function type(value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    await settle(() => input()!.dispatchEvent(new Event('input', { bubbles: true })));
}

test('Typing a whole number from 1 saves it and shows the board the server answers with', async () => {
    await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }));
    await pick('number');
    await type('4');
    answerSave(200, { error: null, board: withLimit({ limit: 4, automatic: 2 }) });
    await settle(() => saveButton().click());
    expect(posted()).toEqual([{ limit: 4 }]);
    expect(picked()).toEqual(['number']);
    expect(input()!.value).toBe('4');
    expect(alerts()).toEqual([]);
});

test('A typed limit survives a search that shows another section, hides its row or finds nothing', async () => {
    await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }));
    await pick('number');
    await type('7');

    const search = $<HTMLInputElement>('[data-settings-nav] input[aria-label="Search settings"]')!;
    const find = (value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);

        return settle(() => search.dispatchEvent(new Event('input', { bubbles: true })));
    };
    const shown = () => !input()!.closest('[hidden]');

    for (const query of ['appearance', 'automatic build', 'zzz']) {
        await find(query);
        expect(input()!.value).toBe('7');
        expect(shown()).toBe(false);
        expect(saveButton()).toBeDefined();
    }
    await find('');
    expect(shown()).toBe(true);
    expect(picked()).toEqual(['number']);
    expect(input()!.value).toBe('7');
});

test('The row refuses anything but a whole number from 1', async () => {
    await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }));
    await pick('number');
    for (const value of ['', '0', '-1', '2.5', 'many']) {
        await type(value);
        expect(saveButton().disabled, `value ${value}`).toBe(true);

        if (value) expect(text(row()), `value ${value}`).toContain('Enter a whole number from 1.');
    }
    expect(posted()).toEqual([]);
});

test('An invalid file shows its effective Automatic fallback, with a note', async () => {
    const problem =
        'The heavy command limit setting /data/heavy-command-limit.json needs a limit of "automatic" or a whole number from 1.';

    await openGeneral(withLimit({ limit: 'automatic', automatic: 2, problem }));
    expect(picked()).toEqual(['automatic']);
    expect(alerts()).toEqual([`${problem} The board uses Automatic until you save a choice.`]);
    answerSave(200, { error: null, board: withLimit({ limit: 'automatic', automatic: 2 }) });
    await settle(() => $<HTMLButtonElement>('[data-save-automatic="heavy-command-limit"]')!.click());
    expect(posted()).toEqual([{ limit: 'automatic' }]);
    expect(picked()).toEqual(['automatic']);
    expect(alerts()).toEqual([]);
});
