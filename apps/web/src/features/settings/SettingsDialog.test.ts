// Settings: the bundled skills' credits, the update channel, and Add project's draft. The bridge stands in for the
// app's preload.

import { type BundledSkill, type UpdateChannel, type UpdateState } from '@lar-factory/shared';
import { describe, expect, test, vi } from 'vite-plus/test';

import { project, serve } from '@/test/OnboardingTest';
import { $, $$, mountPage, chooseOption, sample, settle, stubApp, text } from '@/test/PageTest';

const settingsButton = () => $<HTMLButtonElement>('.open-settings');
const modal = () => $('[data-slot="modal-content"]');
const sections = () => $$<HTMLButtonElement>('[data-settings-nav] button');
const section = (label: string) => sections().find((b) => text(b) === label)!;
const body = () => $('[data-settings-body]')!;
const row = (id: string) => $(`.settings-row[data-row="${id}"]`)!;
const switches = () => $$<HTMLButtonElement>('[data-settings-body] [role="switch"]');

async function type(input: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Mounts `data`, opens Settings and shows `label`'s section. */
async function open(label = 'Skills', data = sample): Promise<void> {
    await mountPage(data);
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

test('Skills credits each bundled skill with no install controls in the app', async () => {
    const lar = { author: 'Lar', licence: 'MIT' };
    const bundledSkills: BundledSkill[] = ['lar-shape', 'lar-build'].map((name) => ({
        name,
        ...lar,
        source: `https://github.com/maddec01/lar-factory/tree/main/skills/${name}`,
    }));

    stubApp({});
    await open('Skills', { ...sample, bundledSkills });
    expect(text(row('bundled-lar-shape'))).toContain('Lar');
    expect(text(row('bundled-lar-build'))).toContain('MIT');
    expect(row('bundled-lar-build').querySelector('a[aria-label="lar-build source"]')).not.toBeNull();
    expect(switches()).toEqual([]);
    expect(text(body())).not.toMatch(/Skill folders|Drift|Replace|Retry/);
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
