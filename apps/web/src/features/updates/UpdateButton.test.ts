// The title bar's update pill: hidden with no update, then "Update available", a progress ring with the percentage
// while it downloads, and "Restart to update" once downloaded. Hovering it shows the changelog with the next step's
// button. The bridge stands in for the app's preload and pushes each new update state, as the app does.

import type { UpdateState } from '@lar-factory/shared';
import { describe, expect, test, vi } from 'vite-plus/test';

import { $, answerRestart, mountPage, settle, stubApp, text, toast } from '@/test/PageTest';

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

function stubBridge(start: UpdateState, restart = true) {
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
        confirmRestart: answerRestart(restart),
    });

    return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
}

const pill = () => $<HTMLElement>('.title-bar .update-button');
const disabled = () => pill()!.getAttribute('aria-disabled') === 'true';
const icon = (name: string) => pill()!.querySelector(`svg.lucide-${name}`);
const click = () => settle(() => pill()!.click());
const toastText = () => toast()?.textContent;
const changelog = () => $('[data-slot="popover-content"]');

describe('available', () => {
    test('a pill reads "Update available", just before Settings, and clicking it downloads', async () => {
        const { bridge } = stubBridge(available);

        await mountPage();
        expect(text(pill())).toBe('Update available');
        expect(pill()!.classList, 'an App control’s corners, not a pill').not.toContain('rounded-full');
        expect([pill()!.getAttribute('data-kind'), pill()!.classList.contains('text-primary-fg')]).toEqual([
            'control',
            true,
        ]);
        expect(icon('arrow-down-to-line')).not.toBeNull();

        const controls = [...pill()!.closest('.title-bar')!.querySelectorAll('button')];

        expect(
            controls[controls.indexOf(pill() as HTMLButtonElement) + 1]!.classList,
            'Settings comes right after it',
        ).toContain('open-settings');
        await click();
        expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    });

    test('a failed download is available again and retries the download', async () => {
        const { bridge } = stubBridge(downloadFailed);

        await mountPage();
        expect(text(pill())).toBe('Update available');
        await click();
        expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    });

    test('a download that fails returns to available, and T3’s toast gives the reason', async () => {
        const { bridge, push } = stubBridge(available);

        bridge.downloadUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloadFailed });
        await mountPage();
        await click();
        await push(downloadFailed);
        expect(text(pill())).toBe('Update available');
        expect(toastText()).toBe('Couldn’t download update net::ERR_TIMED_OUT');
    });

    test('a download the app refuses shows the not-accepted toast and stays available', async () => {
        const { bridge } = stubBridge(available);

        bridge.downloadUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: available });
        await mountPage();
        await click();
        expect(toastText()).toBe('Update not downloaded Download it from the update button once the updater is free.');
        expect(text(pill())).toBe('Update available');
    });

    test('a second click while the download call runs does nothing', async () => {
        const { bridge } = stubBridge(available);

        bridge.downloadUpdate.mockImplementationOnce(() => new Promise(() => {}));
        await mountPage();
        await click();
        expect(disabled()).toBe(true);
        await click();
        expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    });
});

describe('downloaded', () => {
    test('reads "Restart to update"; clicking it asks to restart, then installs on Restart', async () => {
        const { bridge } = stubBridge(downloaded);

        await mountPage();
        expect(text(pill())).toBe('Restart to update');
        expect(
            [pill()!.getAttribute('data-kind'), pill()!.classList.contains('text-primary-fg')],
            'tinted, not filled',
        ).toEqual(['control', true]);
        expect(pill()!.classList).not.toContain('bg-primary');
        expect(icon('rotate-ccw')).not.toBeNull();
        await click();
        expect(bridge.confirmRestart).toHaveBeenCalledExactlyOnceWith('The board app will restart to install 1.1.0.');
        expect(bridge.installUpdate).toHaveBeenCalledOnce();
    });

    test('Cancel leaves the update downloaded, to install later', async () => {
        const { bridge } = stubBridge(downloaded, false);

        await mountPage();
        await click();
        expect(bridge.installUpdate).not.toHaveBeenCalled();
        expect(text(pill())).toBe('Restart to update');
        expect(disabled()).toBe(false);
        expect(toast()).toBeNull();
    });

    test('a failed install reads "Restart to update" again and retries the install', async () => {
        const { bridge } = stubBridge(installFailed);

        await mountPage();
        expect(text(pill())).toBe('Restart to update');
        await click();
        expect(bridge.installUpdate).toHaveBeenCalledOnce();
    });

    test('an install that fails returns to "Restart to update", and T3’s toast gives the reason', async () => {
        const { bridge } = stubBridge(downloaded);

        bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: installFailed });
        await mountPage();
        await click();
        expect(text(pill())).toBe('Restart to update');
        expect(disabled()).toBe(false);
        expect(toastText()).toBe('Couldn’t install update quit refused');
    });

    test('a background check keeps the pill, disabled until it ends', async () => {
        const { bridge, push } = stubBridge(downloaded);

        await mountPage();
        await push({ ...downloaded, status: 'checking', canRetry: false });
        expect(text(pill())).toBe('Restart to update');
        expect(disabled()).toBe(true);
        await click();
        expect(bridge.installUpdate).not.toHaveBeenCalled();
    });
});

describe('installing', () => {
    test('a failed install the app pushes later ends it, and clicking retries', async () => {
        const { bridge, push } = stubBridge(downloaded);

        bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloaded });
        await mountPage();
        await click();
        expect(text(pill())).toBe('Installing…');
        await push(installFailed);
        expect(text(pill())).toBe('Restart to update');
        await click();
        expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
    });
});

describe('the changelog', () => {
    test('opens on keyboard focus, which stays on the pill, and Escape closes it', async () => {
        stubBridge(withNotes);
        await mountPage();
        // Tab pressed on the page, which jsdom's :focus-visible reads.
        await settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
        await settle(() => pill()!.focus());
        expect(changelog()).not.toBeNull();
        expect(document.activeElement).toBe(pill());
        await settle(() => pill()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(changelog()).toBeNull();
    });
});
