// Update entry points exercised through the page and its desktop bridge.

import type { UpdateState } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, mountPage, settle, stubApp, text, toast } from '@/test/PageTest';

const idle: UpdateState = {
    enabled: true,
    status: 'up-to-date',
    channel: 'latest',
    currentVersion: '1.0.0',
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: '2026-10-21T09:00:00Z',
    message: null,
    errorContext: null,
    canRetry: false,
};
const available: UpdateState = { ...idle, status: 'available', availableVersion: '1.1.0' };
const downloading: UpdateState = { ...available, status: 'downloading', downloadPercent: 42.4 };
const downloaded: UpdateState = {
    ...available,
    status: 'downloaded',
    downloadedVersion: '1.1.0',
    downloadPercent: 100,
    canRetry: true,
};
const downloadFailed: UpdateState = {
    ...available,
    errorContext: 'download',
    canRetry: true,
    message: 'net::ERR_TIMED_OUT',
};
const installFailed: UpdateState = { ...downloaded, errorContext: 'install', message: 'quit refused' };
const withNotes: UpdateState = {
    ...available,
    releaseNotes: [
        {
            version: '1.1.0',
            items: ['feat(board): show the changelog', 'fix(board): keep the header steady'],
            totalItems: 2,
        },
        { version: '1.0.1', items: ['fix(board): retry a failed download'], totalItems: 11 },
    ],
    omittedReleaseCount: 3,
};

function stubBridge(start: UpdateState) {
    let push: (state: UpdateState) => void = () => {};
    const action = (state: UpdateState) => vi.fn(async () => ({ accepted: true, completed: false, state }));
    const bridge = stubApp({
        getUpdateState: vi.fn(async () => start),
        onUpdateState: vi.fn((listener: (state: UpdateState) => void) => {
            push = listener;

            return () => {};
        }),
        checkForUpdate: vi.fn(async () => ({ checked: true, state: idle })),
        downloadUpdate: action(downloading),
        installUpdate: action(downloaded),
    });

    return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
}

const control = () => $<HTMLButtonElement>('.title-bar .update-button')!;
const popover = () => $('[data-slot="popover-content"]');
const confirmation = () => $('[data-restart-confirm]');
const click = () => settle(() => control().click());
const next = () => settle(() => $<HTMLButtonElement>('.update-next')!.click());
const answer = (label: string) =>
    settle(() =>
        [...confirmation()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!.click(),
    );
const escape = () =>
    settle(() =>
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
    );
const requestRestart = async () => {
    await click();
    await next();
};

test('the quiet icon sits before Settings and downloads only from its click-open details', async () => {
    const { bridge } = stubBridge(withNotes);

    await mountPage();
    expect(text(control())).toBe('');
    expect(control().getAttribute('aria-label')).toBe('Update to 1.1.0');
    expect(control().getAttribute('data-kind')).toBe('control');
    expect(control().querySelector('svg.lucide-circle-fading-arrow-up')).not.toBeNull();
    expect(control().nextElementSibling!.classList).toContain('open-settings');
    await settle(() => control().focus());
    expect(popover()).toBeNull();
    await click();
    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    expect(text(popover())).toContain('Lar Factory 1.1.0');
    expect(text(popover())).toContain('You have 1.0.0');
    expect(text(popover())).toContain('feat(board): show the changelog');
    expect(text(popover())).toContain('10 more changes in this release');
    expect(text(popover())).toContain('3 older releases not shown');
    await next();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
});

test('Escape closes details and returns focus to the icon', async () => {
    stubBridge(available);
    await mountPage();
    await click();
    expect(popover()).not.toBeNull();
    await escape();
    expect(popover()).toBeNull();
    await settle(() => vi.advanceTimersByTime(0));
    expect(document.activeElement === control()).toBe(true);
});

test('the same anchored popover survives download progress and completion', async () => {
    const { push } = stubBridge(withNotes);

    await mountPage();
    await click();

    const details = popover();

    await push({ ...downloading, releaseNotes: withNotes.releaseNotes });
    expect(popover()).toBe(details);
    expect(control().getAttribute('aria-label')).toBe('Downloading 1.1.0 · 42%');
    expect(control().querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('42');
    expect(text(popover())).toContain('Downloading 1.1.0… 42%');
    expect($('.update-next')).toBeNull();
    await push(downloaded);
    expect(popover()).toBe(details);
    expect(text($('.update-next'))).toBe('Restart now');
});

test('an empty changelog leaves the versions and action usable', async () => {
    stubBridge(available);
    await mountPage();
    await click();
    expect(text(popover())).toContain('You have 1.0.0');
    expect(text($('.update-next'))).toBe('Download');
});

test.each([idle, { ...idle, status: 'checking' as const }, { ...idle, enabled: false, status: 'disabled' as const }])(
    'no actionable update hides the icon: $status',
    async (state) => {
        stubBridge(state);
        await mountPage();
        expect(control()).toBeNull();
    },
);

test('restart closes details and asks in the board dialog before installing', async () => {
    const { bridge } = stubBridge(downloaded);

    await mountPage();
    await requestRestart();
    expect(popover()).toBeNull();
    expect(text(confirmation())).toContain('Restart to install 1.1.0?');
    expect(text(confirmation())).toContain('Lar Factory will restart to install 1.1.0.');
    expect(confirmation()!.getAttribute('role')).toBe('alertdialog');
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    await answer('Restart now');
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
    expect(confirmation()).not.toBeNull();
    expect(confirmation()!.querySelector('[aria-busy="true"]')).not.toBeNull();
    await answer('Restart now');
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
});

test.each(['Later', 'Escape'])(
    '%s cancels without losing the downloaded update and restores focus',
    async (dismissal) => {
        const { bridge } = stubBridge(downloaded);

        await mountPage();
        await requestRestart();

        if (dismissal === 'Later') await answer('Later');
        else await escape();

        expect(confirmation()).toBeNull();
        await settle(() => vi.advanceTimersByTime(0));
        expect(document.activeElement === control()).toBe(true);
        expect(bridge.installUpdate).not.toHaveBeenCalled();
        expect(control().getAttribute('aria-label')).toBe('Restart to install 1.1.0');
        expect(toast()).toBeNull();
        await requestRestart();
        expect(confirmation()).not.toBeNull();
    },
);

test.each(['refused', 'failed', 'rejected'])(
    'a %s install ends the busy dialog, keeps the update and permits retry',
    async (failure) => {
        const { bridge } = stubBridge(downloaded);

        if (failure === 'rejected') bridge.installUpdate.mockRejectedValueOnce(new Error('quit refused'));
        else
            bridge.installUpdate.mockResolvedValueOnce({
                accepted: failure !== 'refused',
                completed: false,
                state: failure === 'failed' ? installFailed : downloaded,
            });

        await mountPage();
        await requestRestart();
        await answer('Restart now');
        expect(confirmation()).toBeNull();
        expect(control().getAttribute('aria-label')).toBe('Restart to install 1.1.0');
        expect(text(toast())).toContain(failure === 'refused' ? 'Update downloaded' : 'Couldn’t install update');
        await requestRestart();
        await answer('Restart now');
        expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
    },
);

test('a pushed install failure ends the busy dialog and permits retry', async () => {
    const { bridge, push } = stubBridge(downloaded);

    await mountPage();
    await requestRestart();
    await answer('Restart now');
    await push(installFailed);
    expect(confirmation()).toBeNull();
    await requestRestart();
    await answer('Restart now');
    expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
});

test('a background check retains the restart indicator and blocks installation until finished', async () => {
    const { bridge, push } = stubBridge(downloaded);

    await mountPage();
    await push({ ...downloaded, status: 'checking' });
    expect(control().getAttribute('aria-label')).toBe('Restart to install 1.1.0');
    await click();
    expect($<HTMLButtonElement>('.update-next')!.disabled).toBe(true);
    await next();
    expect(confirmation()).toBeNull();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    await push(downloaded);
    await next();
    expect(confirmation()).not.toBeNull();
});

test('a pending download cannot run twice and failure leaves Download available', async () => {
    const { bridge, push } = stubBridge(available);
    let finish!: (value: { accepted: boolean; completed: boolean; state: UpdateState }) => void;

    bridge.downloadUpdate.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await mountPage();
    await click();
    await next();
    await next();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    await settle(() => finish({ accepted: true, completed: false, state: downloadFailed }));
    await push(downloadFailed);
    expect(text(toast())).toContain('Couldn’t download update net::ERR_TIMED_OUT');
    await next();
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(2);
});

test('a refused download keeps its feedback and retry', async () => {
    const { bridge } = stubBridge(available);

    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: available });
    await mountPage();
    await click();
    await next();
    expect(text(toast())).toContain('Update not downloaded');
    await next();
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(2);
});

test.each(['download', 'restart'])(
    'Board search keeps its direct %s action and returns focus after cancellation',
    async (action) => {
        const { bridge } = stubBridge(action === 'download' ? available : downloaded);

        await mountPage();

        const field = $<HTMLButtonElement>('[data-search-field]')!;

        await settle(() => field.click());

        const option = [...document.querySelectorAll<HTMLElement>('[data-command-palette] [role="option"]')].find(
            (el) => text(el).includes(action === 'download' ? 'Download the update' : 'Restart to update'),
        )!;

        await settle(() => option.click());
        expect($('[data-command-palette]')).toBeNull();

        if (action === 'download') expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
        else {
            expect(bridge.installUpdate).not.toHaveBeenCalled();
            expect(confirmation()).not.toBeNull();
            await answer('Later');
            await settle(() => vi.advanceTimersByTime(100));
            expect(document.activeElement === field).toBe(true);
        }
    },
);

test('all entry points share the guards while checking and confirming', async () => {
    const { bridge } = stubBridge(downloaded);

    await mountPage();

    const { useUpdateStore } = await import('./UpdateStore');
    const store = useUpdateStore.getState;
    let finish!: (value: { checked: boolean; state: UpdateState }) => void;

    bridge.checkForUpdate.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await settle(() => {
        void store().check();
        void store().check();
        void store().run();
    });
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
    expect(confirmation()).toBeNull();
    await settle(() => finish({ checked: true, state: downloaded }));
    await requestRestart();
    await settle(() => {
        void store().check();
        void store().run();
        void store().download();
    });
    expect(document.querySelectorAll('[data-restart-confirm]')).toHaveLength(1);
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
    expect(bridge.downloadUpdate).not.toHaveBeenCalled();
    await answer('Restart now');
    await settle(() => {
        void store().check();
        void store().run();
        void store().confirmInstall();
    });
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
});
