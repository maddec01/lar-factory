// Update entry points exercised through the page and its desktop bridge.

import type { UpdateState } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, mountPage, settle, stubApp, text } from '@/test/PageTest';

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

const control = () => $<HTMLButtonElement>('.title-bar [data-update-button]')!;
const popover = () => $('[data-slot="popover-content"]');
const confirmation = () => $('[data-restart-confirm]');
const click = () => settle(() => control().click());
const next = () => settle(() => $<HTMLButtonElement>('[data-update-next]')!.click());
const answer = (label: string) =>
    settle(() =>
        [...confirmation()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!.click(),
    );
const requestRestart = async () => {
    await click();
    await next();
};

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
