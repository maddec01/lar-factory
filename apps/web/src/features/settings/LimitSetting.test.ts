// Settings › General: the heavy command limit and the build limit, each Automatic or a typed whole number from 1, which
// posts to the board server and shows the board it answers with.

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
const saveButton = () => $<HTMLButtonElement>('[data-save-limit="heavy-command-limit"]')!;
const alerts = (name = 'heavy-command-limit') => $$(`[data-limit="${name}"] [role="alert"]`).map(text);
const posted = (name = 'heavy-command-limit') =>
    fetchMock.mock.calls
        .filter(([url]) => url === `/api/${name}`)
        .map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withLimit = (state?: HeavyCommandLimitState, build?: BuildLimitState): BoardData => ({
    ...sample,
    ...(state && { heavyCommandLimit: state }),
    ...(build && { buildLimit: build }),
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

test('General has the row in its own group with the build limit, showing Automatic with the number it gives', async () => {
    await openGeneral(withLimit({ limit: 'automatic', automatic: 3 }));
    expect(
        [...row().closest('section')!.querySelectorAll<HTMLElement>('.settings-row')].map((r) => r.dataset.row),
    ).toEqual(['heavy-command-limit', 'build-limit']);
    expect(text(row().querySelector('.settings-row-title'))).toBe('Heavy commands at once');
    expect(text(select())).toBe('Automatic (3)');
    expect(picked()).toEqual(['automatic']);
    expect(input()).toBeNull();
});

test('A saved number shows in its field', async () => {
    await openGeneral(withLimit({ limit: 5, automatic: 2 }));
    expect(picked()).toEqual(['number']);
    expect(input()!.value).toBe('5');
});

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

test('Picking Automatic saves it', async () => {
    await openGeneral(withLimit({ limit: 5, automatic: 2 }));
    answerSave(200, { error: null, board: withLimit({ limit: 'automatic', automatic: 2 }) });
    await pick('automatic');
    expect(posted()).toEqual([{ limit: 'automatic' }]);
    expect(picked()).toEqual(['automatic']);
    expect(input()).toBeNull();
});

test('An invalid file picks no option, with a note, and picking Automatic replaces it', async () => {
    const problem =
        'The heavy command limit setting /data/heavy-command-limit.json needs a limit of "automatic" or a whole number from 1.';

    await openGeneral(withLimit({ limit: 'automatic', automatic: 2, problem }));
    expect(picked()).toEqual([]);
    expect(alerts()).toEqual([`${problem} The board uses Automatic until you save a choice.`]);
    answerSave(200, { error: null, board: withLimit({ limit: 'automatic', automatic: 2 }) });
    await pick('automatic');
    expect(posted()).toEqual([{ limit: 'automatic' }]);
    expect(picked()).toEqual(['automatic']);
    expect(alerts()).toEqual([]);
});

test('Switching to Number starts from the Automatic number', async () => {
    await openGeneral(withLimit({ limit: 'automatic', automatic: 3 }));
    await pick('number');
    expect(input()!.value).toBe('3');
});

test('Enter in the field saves the number', async () => {
    await openGeneral(withLimit({ limit: 5, automatic: 2 }));
    await type('6');
    answerSave(200, { error: null, board: withLimit({ limit: 6, automatic: 2 }) });
    await settle(() => input()!.form!.requestSubmit());
    expect(posted()).toEqual([{ limit: 6 }]);
});

test('Save keeps focus and stays unavailable while the field holds the saved number', async () => {
    await openGeneral(withLimit({ limit: 5, automatic: 2 }));
    expect(saveButton().getAttribute('aria-disabled')).toBe('true');
    await settle(() => input()!.form!.requestSubmit());
    expect(posted()).toEqual([]);
    await type('6');
    expect(saveButton().hasAttribute('aria-disabled')).toBe(false);
    answerSave(200, { error: null, board: withLimit({ limit: 6, automatic: 2 }) });
    saveButton().focus();
    await settle(() => saveButton().click());
    expect(posted()).toEqual([{ limit: 6 }]);
    expect(saveButton().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(saveButton());
});

test('The whole-number hint describes the field it refuses', async () => {
    await openGeneral(withLimit({ limit: 5, automatic: 2 }));
    expect(input()!.hasAttribute('aria-invalid')).toBe(false);
    await type('many');
    expect(input()!.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.getElementById(input()!.getAttribute('aria-describedby')!))).toBe(
        'Enter a whole number from 1.',
    );
});

test('In sample mode nothing is picked and a save shows why it was refused', async () => {
    await openGeneral(withLimit());
    expect(picked()).toEqual([]);
    answerSave(403, { error: 'The heavy command limit is disabled in sample mode.' });
    await pick('automatic');
    expect(picked()).toEqual([]);
    expect(alerts()).toEqual(['The heavy command limit is disabled in sample mode.']);
});

test('Builds at once shows Automatic with the heavy command limit it follows, and saves to its own setting', async () => {
    await openGeneral(withLimit({ limit: 4, automatic: 2 }, { limit: 'automatic', automatic: 4 }));

    const build = $('.settings-row[data-row="build-limit"]')!;

    expect(text(build.querySelector('.settings-row-title'))).toBe('Builds at once');
    expect(text(select('build-limit'))).toBe('Automatic (4)');
    expect(picked('build-limit')).toEqual(['automatic']);
    await pick('number', 'build-limit');

    const field = $<HTMLInputElement>('[data-limit="build-limit"] input[aria-label="Build limit"]')!;

    expect(field.value).toBe('4');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '1');
    await settle(() => field.dispatchEvent(new Event('input', { bubbles: true })));
    answerSave(200, { error: null, board: withLimit({ limit: 4, automatic: 2 }, { limit: 1, automatic: 4 }) });
    await settle(() => $<HTMLButtonElement>('[data-save-limit="build-limit"]')!.click());
    expect([posted('build-limit'), posted()]).toEqual([[{ limit: 1 }], []]);
    expect(picked('build-limit')).toEqual(['number']);
});

test('An invalid build limit file picks no option, with a note', async () => {
    const problem = "The build limit setting /data/build-limit.json isn't JSON: Unexpected end of JSON input.";

    await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }, { limit: 'automatic', automatic: 2, problem }));
    expect(picked('build-limit')).toEqual([]);
    expect(alerts('build-limit')).toEqual([`${problem} The board uses Automatic until you save a choice.`]);
    expect(picked()).toEqual(['automatic']);
});
