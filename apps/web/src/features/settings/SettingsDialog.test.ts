// Settings: the Skill folders with their switches and what a change did, Drift's Replace, the update channel, and
// Add project's draft. The bridge stands in for the app's preload.

import {
    type InstallOperationResult,
    type InstallSnapshot,
    type TargetSnapshot,
    type UpdateChannel,
    type UpdateState,
} from '@lar-factory/shared';
import { describe, expect, test, vi } from 'vite-plus/test';

import { project, serve } from '@/test/OnboardingTest';
import { $, $$, mountPage, chooseOption, sample, settle, stubApp, text } from '@/test/PageTest';

/** A Claude target at `path`, ticked when `active`. */
const targetAt = (path: string, active: boolean, extra: Partial<TargetSnapshot> = {}): TargetSnapshot => ({
    kind: 'claude',
    path,
    paths: [path],
    locked: false,
    active,
    finished: active,
    instances: [],
    skills: [],
    ...extra,
});

const snapshotOf = (claude: boolean, work: boolean, extra: Partial<InstallSnapshot> = {}): InstallSnapshot => ({
    installs: true,
    installed: true,
    version: '0.2.0',
    running: null,
    discovery: 'not-running',
    instances: [],
    targets: [
        targetAt('~/.agents/skills', true, { kind: 'agents', locked: true }),
        targetAt('~/.claude/skills', claude),
        targetAt('~/.claude-work/skills', work),
    ],
    drift: [],
    replaced: [],
    conflicts: [],
    blocked: [],
    ...extra,
});

const listed = snapshotOf(true, false);
const bothTicked = snapshotOf(true, true);

/**
 * The app's bridge, whose `getInstallState` is Settings' reads: the page's Drift warning reads the state once as it
 * mounts, and that read gets `listed`.
 */
function stubBridge(setResult: InstallOperationResult = { snapshot: listed }) {
    let push: (snapshot: InstallSnapshot) => void = () => {};
    const reads = vi.fn(async () => listed);
    let mounted = false;
    const bridge = stubApp({
        getInstallState: () => (mounted ? reads() : ((mounted = true), Promise.resolve(listed))),
        onInstallState: vi.fn((listener: (snapshot: InstallSnapshot) => void) => {
            push = listener;

            return () => {
                push = () => {};
            };
        }),
        setTargetTick: vi.fn(async (_path: string, _ticked: boolean) => setResult),
    });

    return { ...bridge, getInstallState: reads, push: (snapshot: InstallSnapshot) => settle(() => push(snapshot)) };
}

const settingsButton = () => $<HTMLButtonElement>('.open-settings');
const modal = () => $('[data-slot="modal-content"]');
const sections = () => $$<HTMLButtonElement>('[data-settings-nav] button');
const section = (label: string) => sections().find((b) => text(b) === label)!;
const close = () => modal()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
const body = () => $('[data-settings-body]')!;
const row = (id: string) => $(`.settings-row[data-row="${id}"]`)!;
const switches = () => $$<HTMLButtonElement>('[data-settings-body] [role="switch"]');
const ticked = (box: Element) => box.getAttribute('aria-checked') === 'true';
const result = () => $('#settings-result')!;

async function type(input: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Mounts the sample page, opens Settings and shows `label`'s section. */
async function open(label = 'Skills'): Promise<void> {
    await mountPage(sample);
    await settle(() => settingsButton()!.click());
    await settle(() => section(label).click());
    await settle(() => vi.advanceTimersByTime(50));
}

const pane = () => $('[data-onboarding-pane]');
/** The setup's way back, the arrow before the header's trail. */
const back = () => modal()!.querySelector<HTMLButtonElement>('[data-slot="modal-header"] button[aria-label="Back"]')!;
const button = (within: Element | null, label: string) =>
    [...(within?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => text(b) === label);

test('a folder typed for a new T3 project is a draft Back asks about first', async () => {
    serve(sample, [project('lar-web')]);
    await open('Projects');
    await settle(() => button(body(), 'Add project')!.click());
    await settle(() => pane()!.querySelector<HTMLInputElement>('[data-choice="new"] input[type="radio"]')!.click());
    await type(pane()!.querySelector<HTMLInputElement>('input[aria-label="Repository folder"]')!, '~/Developer/new');
    await settle(() => back().click());
    await settle(() => vi.advanceTimersByTime(100));
    expect(text($('[role="alertdialog"]'))).toContain('Discard changes?');
    await settle(() => button($('[role="alertdialog"]'), 'Discard changes')!.click());
    await settle(() => vi.advanceTimersByTime(100));
    expect(pane()).toBeNull();
});

/** The switch of the target at `path`. */
const switchOf = (path: string) => switches().find((box) => box.getAttribute('aria-label') === path)!;
const profileTicks = () => ['~/.claude/skills', '~/.claude-work/skills'].map((path) => ticked(switchOf(path)));

test('ticking a target installs it and shows the new ticks', async () => {
    const bridge = stubBridge({ snapshot: bothTicked });

    await open();
    await settle(() => switchOf('~/.claude-work/skills').click());
    expect(bridge.setTargetTick).toHaveBeenCalledWith('~/.claude-work/skills', true);
    expect(profileTicks()).toEqual([true, true]);
    expect(result().textContent).toBe('Installed the skills into ~/.claude-work/skills.');
    expect(result().dataset.tone).toBe('success');
});

describe('updates', () => {
    const nightly: UpdateState = {
        enabled: true,
        status: 'up-to-date',
        channel: 'nightly',
        currentVersion: '0.2.0-nightly.20261023.41',
        availableVersion: null,
        downloadedVersion: null,
        releaseNotes: [],
        omittedReleaseCount: 0,
        downloadPercent: null,
        checkedAt: '2026-10-23T09:00:00Z',
        message: null,
        errorContext: null,
        canRetry: false,
    };

    function stubChannel(start: UpdateState = nightly) {
        let push: (state: UpdateState) => void = () => {};
        const bridge = stubApp({
            getInstallState: vi.fn(async () => listed),
            getUpdateState: vi.fn(async () => start),
            onUpdateState: vi.fn((listener: (state: UpdateState) => void) => {
                push = listener;

                return () => {};
            }),
            setUpdateChannel: vi.fn(async (channel: UpdateChannel) => ({ ...start, channel })),
            checkForUpdate: vi.fn(async () => ({ checked: true, state: start })),
            downloadUpdate: vi.fn(async () => ({ accepted: true, completed: false, state: start })),
            installUpdate: vi.fn(async () => ({ accepted: true, completed: false, state: start })),
        });

        return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
    }

    const select = () => $('[data-settings-body] [role="combobox"]')!;
    const checked = () => text(select()).toLowerCase();
    const pick = (channel: UpdateChannel) => chooseOption(select(), channel === 'latest' ? 'Latest' : 'Nightly');
    const status = () => $('#update-status')!.textContent;
    const checkNow = () => $<HTMLButtonElement>('[data-settings-body] [data-check-now]')!;

    test('choosing a channel switches the app to it and shows what its check found', async () => {
        const { bridge, push } = stubChannel();

        await open('Updates');
        await pick('latest');
        expect(bridge.setUpdateChannel).toHaveBeenCalledWith('latest');
        expect(checked()).toBe('latest');
        await push({ ...nightly, channel: 'latest', status: 'checking' });
        expect(status()).toBe('Checking for updates…');
        expect(checkNow().disabled).toBe(true);
        await push({
            ...nightly,
            channel: 'latest',
            status: 'available',
            availableVersion: '0.1.9-nightly.20261020.12',
        });
        expect(status()).toBe('0.1.9-nightly.20261020.12 is available.');
    });
});

test('a push before the initial Settings read wins and uses the shared subscription', async () => {
    const bridge = stubBridge();
    let finish!: (snapshot: InstallSnapshot) => void;

    bridge.getInstallState.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await open();
    await bridge.push({ ...bothTicked, revision: 2 });
    await settle(() => finish({ ...listed, revision: 1 }));
    expect(profileTicks()).toEqual([true, true]);
    expect(bridge.onInstallState).toHaveBeenCalledOnce();
    await settle(() => close().click());
    await bridge.push({ ...listed, revision: 3 });
    await settle(() => settingsButton()!.click());
    expect(profileTicks()).toEqual([true, false]);
    expect(bridge.setTargetTick).not.toHaveBeenCalled();
});

test('dismissed Drift stays in Settings with failed Replace and later recovery', async () => {
    const target = targetAt('~/.agents/skills', true, {
        kind: 'agents',
        locked: true,
        release: '0.2.0',
        finished: false,
        skills: [{ name: 'lar-build', state: 'drift' }],
    });
    const drifted: InstallSnapshot = {
        ...listed,
        targets: [target],
        drift: [{ skill: 'lar-build', paths: [{ place: 'agents', path: '~/.agents/skills/lar-build' }] }],
    };
    let pushInstall = (_next: InstallSnapshot) => {};
    const bridge = stubApp({
        getInstallState: vi.fn(async () => drifted),
        onInstallState: (listener: (next: InstallSnapshot) => void) => {
            pushInstall = listener;

            return () => {};
        },
        replaceDrift: vi.fn(async (): Promise<InstallOperationResult> => ({
            snapshot: drifted,
            error: 'EACCES: ~/.agents/skills/lar-build',
        })),
    });

    await open();

    const warning = () => $('[data-warning="drift"]')?.closest('[data-slot="toast"]');

    expect(warning()).toBeUndefined();
    await settle(() => pushInstall({ ...drifted }));
    await settle(() => section('General').click());
    await settle(() => section('Skills').click());
    expect(warning()).toBeUndefined();
    expect(text(row('target-~/.agents/skills'))).toContain('lar-build: Changed');

    const replace = () => row('target-~/.agents/skills').querySelector<HTMLButtonElement>('[data-replace-drift]')!;

    await settle(() => replace().click());
    expect(text(row('target-~/.agents/skills'))).toContain('EACCES');
    expect(replace().disabled).toBe(false);
    expect(warning()).toBeUndefined();

    const recovered = {
        ...drifted,
        drift: [],
        targets: [
            {
                ...target,
                finished: true,
                replaced: ['lar-build'],
                skills: [{ name: 'lar-build', state: 'installed' as const }],
            },
        ],
    };

    bridge.replaceDrift.mockResolvedValueOnce({ snapshot: recovered });
    await settle(() => replace().click());
    expect(text(row('target-~/.agents/skills'))).toContain('Restored skills: lar-build');
    expect(text(body())).not.toContain('EACCES');
    expect(replace()).toBeNull();
    expect(bridge.replaceDrift).toHaveBeenCalledTimes(2);
});
