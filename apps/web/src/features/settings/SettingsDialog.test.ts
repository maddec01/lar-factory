// Settings: the modal with its section list in groups, each section's title and description over its rows, the
// Skill folders with their switches and what a change did, the bundled skills with their last updates and install
// states, the update channel, version, the update pill's state and step, and Check now, the tool rows, the repository rows with Resume and Add project (Edit's dialog and Reset's confirmation have their own tests), and the rows that aren't built yet. The bridge stands in for the app's preload; without it
// the targets and updates explain that they need the board app.

import {
    type BoardData,
    type CheckedTool,
    type InstallOperationResult,
    type InstallSnapshot,
    type TargetSnapshot,
    type UpdateChannel,
    type UpdateState,
} from '@lar-factory/shared';
import { describe, expect, test, vi } from 'vite-plus/test';

import { dialog, project, serve } from '@/test/OnboardingTest';
import {
    $,
    $$,
    answerRestart,
    mountPage,
    chooseOption,
    push,
    sample,
    settle,
    stubApp,
    text,
    textBesideIcon,
    toolChecks,
} from '@/test/PageTest';

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
const search = () => $<HTMLInputElement>('[data-settings-nav] input[aria-label="Search settings"]')!;

async function type(input: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Mounts the page with `data`, opens Settings and shows `label`'s section. */
async function open(label = 'Skills', data: BoardData = sample): Promise<void> {
    await mountPage(data);
    await settle(() => settingsButton()!.click());
    await settle(() => section(label).click());
    await settle(() => vi.advanceTimersByTime(50));
}

test('search keeps the sections whose name or a row matches, and / focuses it', async () => {
    await open('General');
    await type(search(), 'full refresh');
    expect(sections().map(text)).toEqual(['General']);
    await type(search(), 'skill folders');
    expect(sections().map(text)).toEqual(['Skills']);
    expect(
        $$('[data-settings-nav] [role="group"]').map((g) => g.getAttribute('aria-label')),
        'a group with no match goes',
    ).toEqual(['Connections']);
    await type(search(), '');
    expect(sections()).toHaveLength(7);
    search().blur();
    await settle(() =>
        modal()!.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })),
    );
    expect(document.activeElement).toBe(search());
});

test('a search that leaves out the open section shows the first one it keeps, and clearing it goes back', async () => {
    await open('General');
    await type(search(), 'skill folders');
    expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Skills');
    expect(section('Skills').getAttribute('aria-current')).toBe('page');
    await type(search(), '');
    expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('General');
    expect(section('General').getAttribute('aria-current')).toBe('page');
});

test('an empty search replaces the form and clearing it restores the saved selection', async () => {
    await open('Skills');
    await type(search(), 'zzz');
    expect(sections()).toHaveLength(0);
    expect(text(body())).toContain('Nothing matches');
    expect($$('[data-settings-body] .settings-row')).toHaveLength(0);

    const clear = [...body()!.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => text(button) === 'Clear search',
    )!;

    await settle(() => clear.click());
    expect(section('Skills').getAttribute('aria-current')).toBe('page');
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
});

test('Close returns to the board as it was, and Settings opens again on the same section', async () => {
    await mountPage();

    const { useScopeStore } = await import('@/features/filters/ScopeStore');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    await settle(() => settingsButton()!.click());
    await settle(() => section('Diagnostics').click());
    await settle(() => close().click());
    await settle(() => vi.advanceTimersByTime(50));
    expect(modal()).toBeNull();
    expect($('[data-settings-body]')).toBeNull();
    expect($('[data-search-field]')!.getAttribute('aria-description')).toBe('filtered by lar-apple');
    await settle(() => settingsButton()!.click());
    expect(section('Diagnostics').getAttribute('aria-current')).toBe('page');
});

/** Each Settings group's title with its rows' ids. */
const groups = () =>
    $$('[data-settings-group]').map((g) => [
        text(g.querySelector('h3')),
        [...g.querySelectorAll('.settings-row')].map((r) => r.getAttribute('data-row')),
    ]);

test('a repository still onboarding is listed with its provider and its step, and Resume reopens the dialog there', async () => {
    const data: BoardData = {
        ...sample,
        onboarding: [
            {
                repo: 'maddec01/lar-web',
                progress: {
                    step: 'work',
                    done: ['project', 'detect', 'import'],
                    answers: { projectId: 'lar-web', provider: 'GitHub' },
                },
            },
            {
                repo: 'contoso/Fabrikam%20Fiber/lar-api',
                progress: {
                    step: 'checks',
                    done: ['project'],
                    answers: { projectId: 'lar-api', provider: 'Azure DevOps' },
                },
            },
        ],
    };

    serve(data, [project('lar-web', { onBoard: true })]);
    await open('Projects', data);
    expect(groups()[0]).toEqual([
        'Projects',
        [
            ...sample.repos.map((r) => `repo-${r.repo}`),
            'repo-maddec01/lar-web',
            'repo-contoso/Fabrikam%20Fiber/lar-api',
        ],
    ]);
    expect(textBesideIcon(row('repo-maddec01/lar-web'))).toBe(
        'maddec01/lar-webGitHub · Onboarding, stopped at Work and docsResume',
    );
    expect(textBesideIcon(row('repo-contoso/Fabrikam%20Fiber/lar-api')), 'an older board’s step').toBe(
        'contoso/Fabrikam Fiber/lar-apiAzure DevOps · Onboarding, stopped at ProjectResume',
    );
    await settle(() =>
        [...row('repo-maddec01/lar-web').querySelectorAll('button')].find((b) => text(b) === 'Resume')!.click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
    expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Work and docs');
});

const DIAGNOSED = ['d-gh', 'd-t3', 'd-git', 'd-jq', 'd-curl'];

test('Settings shows gh and az Checking while their checks run, though other checks landed, and never as left out', async () => {
    const landed = { git: toolChecks().git };
    const data = {
        ...sample,
        tools: landed,
        toolProgress: { checking: ['gh', 't3', 'jq', 'curl', 'az'] as CheckedTool[], skipped: [] },
    };

    await open('Integrations', data);
    expect(groups()[0]).toEqual(['Issue trackers', ['gh', 'az']]);
    expect(['gh', 'az'].map((id) => text(row(id).querySelector('[data-slot="status-indicator"]')))).toEqual([
        'Checking',
        'Checking',
    ]);
    expect(text(row('az'))).not.toContain('no listed repository');
    await settle(() => section('Diagnostics').click());
    expect([...DIAGNOSED, 'd-az'].map((id) => text(row(id).querySelector('[data-slot="status-indicator"]')))).toEqual([
        'Checking',
        'Checking',
        'OK',
        'Checking',
        'Checking',
        'Checking',
    ]);
    expect(text(row('d-az'))).not.toContain('no listed repository');
    await push({
        ...data,
        tools: { ...landed, az: { result: 'ok', version: '2.67.0' } },
        toolProgress: { ...data.toolProgress, checking: ['gh', 't3', 'jq', 'curl'] },
    });
    expect(text(row('d-az').querySelector('[data-slot="status-indicator"]'))).toBe('2.67.0');
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

test('focus stays on a switch while its change runs and after', async () => {
    const bridge = stubBridge();
    let finish!: (result: InstallOperationResult) => void;

    bridge.setTargetTick.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await open();

    const box = switchOf('~/.claude-work/skills');

    box.focus();
    await settle(() => box.click());
    // A browser blurs a control that turns disabled; jsdom doesn't, so check it stays enabled too.
    expect(box.disabled).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    await settle(() => switchOf('~/.claude/skills').click());
    expect(bridge.setTargetTick).toHaveBeenCalledOnce();
    await settle(() => finish({ snapshot: bothTicked }));
    expect(document.activeElement).toBe(switchOf('~/.claude-work/skills'));
    expect(switchOf('~/.claude-work/skills').getAttribute('aria-disabled')).toBe('false');
    expect(profileTicks()).toEqual([true, true]);
});

test('unticking a Claude target removes its links', async () => {
    const bridge = stubBridge({ snapshot: snapshotOf(false, false), removed: { links: ['tdd'], checklists: true } });

    await open();
    await settle(() => switchOf('~/.claude/skills').click());
    expect(bridge.setTargetTick).toHaveBeenCalledWith('~/.claude/skills', false);
    expect(ticked(switchOf('~/.claude/skills'))).toBe(false);
    expect(result().textContent).toBe('Removed the skill links and checklists from ~/.claude/skills.');
});

test('a refused tick shows its error and keeps the old ticks', async () => {
    stubBridge({ snapshot: listed, error: 'No skills are installed in ~/.agents yet' });
    await open();
    await settle(() => switchOf('~/.claude-work/skills').click());
    expect(profileTicks()).toEqual([true, false]);
    expect(result().textContent).toBe(
        'Couldn’t change ~/.claude-work/skills: No skills are installed in ~/.agents yet',
    );
    expect(result().dataset.tone).toBe('danger');
});

test('Skills says Loading until the state arrives, also when opened again', async () => {
    const bridge = stubBridge();
    let finish!: (snapshot: InstallSnapshot) => void;

    bridge.getInstallState.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await open();
    expect(text(body())).toContain('Loading…');
    expect($('.settings-row[data-row="target-~/.claude/skills"]')).toBeNull();
    await settle(() => finish(listed));
    expect(text(body())).not.toContain('Loading…');
    expect(profileTicks()).toEqual([true, false]);

    await settle(() => close().click());
    bridge.getInstallState.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    await settle(() => settingsButton()!.click());
    expect(section('Skills').getAttribute('aria-current'), 'Settings opens on the section it showed').toBe('page');
    expect(text(body())).toContain('Loading…');
    await settle(() => finish(bothTicked));
    expect(profileTicks()).toEqual([true, true]);
});

test('before the first install the switches show disabled with the reason, and turn on once it finishes', async () => {
    const bridge = stubBridge();

    bridge.getInstallState.mockResolvedValueOnce({ ...listed, installed: false });
    await open();
    expect(text(body())).toContain('Lar Factory hasn’t installed its skills yet');
    expect(['~/.claude/skills', '~/.claude-work/skills'].map((path) => switchOf(path).disabled)).toEqual([true, true]);
    await settle(() => switchOf('~/.claude-work/skills').click());
    expect(bridge.setTargetTick).not.toHaveBeenCalled();

    await bridge.push(listed);
    expect(text(body())).not.toContain('hasn’t installed');
    expect(['~/.claude/skills', '~/.claude-work/skills'].map((path) => switchOf(path).disabled)).toEqual([
        false,
        false,
    ]);
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
            confirmRestart: answerRestart(true),
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

    test('a second choice waits until the first switch ends', async () => {
        const { bridge } = stubChannel();
        let finish!: (state: UpdateState) => void;

        bridge.setUpdateChannel.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        await open('Updates');
        await pick('latest');
        expect(select().getAttribute('aria-disabled')).toBe('true');
        await pick('nightly');
        expect(bridge.setUpdateChannel).toHaveBeenCalledOnce();
        await settle(() => finish({ ...nightly, channel: 'latest' }));
        expect(checked()).toBe('latest');
        expect(select().getAttribute('aria-disabled')).toBe('false');
    });

    test('the channels are busy while an update downloads or installs, when the app would refuse a switch', async () => {
        const downloaded: UpdateState = {
            ...nightly,
            status: 'downloaded',
            availableVersion: '0.2.0-nightly.20261024.42',
            downloadedVersion: '0.2.0-nightly.20261024.42',
            downloadPercent: 100,
            canRetry: true,
        };
        const { bridge, push } = stubChannel({
            ...downloaded,
            status: 'downloading',
            downloadedVersion: null,
            downloadPercent: 40,
        });

        bridge.installUpdate = vi.fn(() => new Promise<never>(() => {}));
        bridge.confirmRestart = answerRestart(true);
        await open('Updates');
        expect(select().getAttribute('aria-disabled')).toBe('true');
        await pick('latest');
        expect(bridge.setUpdateChannel).not.toHaveBeenCalled();
        expect(checked()).toBe('nightly');

        await push(downloaded);
        expect(select().getAttribute('aria-disabled')).toBe('false');
        await settle(() => $<HTMLButtonElement>('.update-button')!.click());
        expect(select().getAttribute('aria-disabled')).toBe('true');
    });

    test('a refused switch keeps the old channel and says why', async () => {
        const { bridge } = stubChannel();

        bridge.setUpdateChannel.mockRejectedValueOnce(
            new Error('Can’t change the update channel to latest while an update download is in progress.'),
        );
        await open('Updates');
        await pick('latest');
        expect(checked()).toBe('nightly');
        expect(result().textContent).toBe(
            'Couldn’t switch to latest: Can’t change the update channel to latest while an update download is in progress.',
        );
        expect(result().dataset.tone).toBe('danger');
    });

    describe('shows the update pill’s state', () => {
        const next = '0.2.0-nightly.20261024.42';
        const available: UpdateState = { ...nightly, status: 'available', availableVersion: next };
        const action = () => $<HTMLButtonElement>('[data-settings-body] [data-update-action]');
        const pill = () => $('.title-bar .update-button')!;

        test('a downloaded update says so, and Restart to update asks, then installs', async () => {
            const { bridge } = stubChannel({
                ...available,
                status: 'downloaded',
                downloadedVersion: next,
                downloadPercent: 100,
            });

            await open('Updates');
            expect([status(), text(pill())]).toEqual([`${next} is ready to install.`, 'Restart to update']);
            expect(text(action())).toBe('Restart to update');
            await settle(() => action()!.click());
            expect(bridge.confirmRestart).toHaveBeenCalledOnce();
            expect(bridge.installUpdate).toHaveBeenCalledOnce();
        });
    });
});

test('dialog preferences default off and persist when Settings reopens', async () => {
    localStorage.removeItem('lar-board:match-list-size');
    localStorage.removeItem('lar-board:open-list-expanded');

    try {
        await open('General');
        expect(switches().map(ticked)).toEqual([false, false]);
        for (const control of switches()) await settle(() => control.click());
        expect(localStorage.getItem('lar-board:match-list-size')).toBe('1');
        expect(localStorage.getItem('lar-board:open-list-expanded')).toBe('1');
        await settle(() => close().click());
        await settle(() => settingsButton()!.click());
        await settle(() => section('General').click());
        expect(switches().map(ticked)).toEqual([true, true]);
    } finally {
        localStorage.removeItem('lar-board:match-list-size');
        localStorage.removeItem('lar-board:open-list-expanded');
    }
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

test('a delayed read failure can’t discard a newer pushed snapshot', async () => {
    const bridge = stubBridge();
    let fail!: (cause: Error) => void;

    bridge.getInstallState.mockImplementationOnce(
        () =>
            new Promise((_resolve, reject) => {
                fail = reject;
            }),
    );
    await open();
    await bridge.push({ ...bothTicked, revision: 2 });
    await settle(() => fail(new Error('old read failed')));
    expect(profileTicks()).toEqual([true, true]);
    expect(result().textContent).not.toContain('old read failed');
});

test('a failed first install can retry globally in Settings after dismissal without target rows', async () => {
    const failed: InstallSnapshot = {
        ...listed,
        overview: 'dismissed',
        installed: false,
        targets: [],
        error: 'EACCES: can’t read the install manifest',
    };
    const bridge = stubApp({
        getInstallState: vi.fn(async () => failed),
        retryInstall: vi.fn(async (): Promise<InstallOperationResult> => ({
            snapshot: failed,
            error: 'Still no permission',
        })),
    });

    await open();

    const retry = () => $<HTMLButtonElement>('[data-settings-body] [data-retry-install]')!;

    expect(retry()).not.toBeNull();
    expect(retry().getAttribute('aria-label')).toContain('all active targets');
    await settle(() => retry().click());
    expect(bridge.retryInstall).toHaveBeenCalledOnce();
    expect(text(body())).toContain('Still no permission');
    expect(retry().disabled).toBe(false);
    bridge.retryInstall.mockResolvedValueOnce({ snapshot: { ...listed, overview: 'dismissed' } });
    await settle(() => retry().click());
    expect(bridge.retryInstall).toHaveBeenCalledTimes(2);
    expect(text(body())).not.toContain('Still no permission');
    expect(text(body())).not.toContain('EACCES');
    expect(profileTicks()).toEqual([true, false]);
    expect($('[data-install-overview]')).toBeNull();
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

test('Settings retains Clash paths and Retry after the overview closes', async () => {
    const clashed: InstallSnapshot = {
        ...listed,
        overview: 'dismissed',
        targets: [
            targetAt('~/.claude/skills', true, {
                finished: false,
                operation: 'install',
                skills: [{ name: 'lar-build', state: 'blocked' }],
            }),
        ],
        blocked: [
            {
                skill: 'lar-build',
                paths: [{ place: 'profile', profile: '.claude', path: '~/.claude/skills/lar-build' }],
            },
        ],
    };
    const bridge = stubApp({
        getInstallState: vi.fn(async () => clashed),
        retryInstall: vi.fn(async () => ({ snapshot: listed })),
    });

    await open();

    const target = row('target-~/.claude/skills');

    expect(text(target)).toContain('lar-build: Existing skill');
    expect(text(target)).toContain('Existing skill at ~/.claude/skills/lar-build');
    expect(text(target)).toContain('doesn’t own this path. Rename or remove it, then Retry.');
    await settle(() => target.querySelector<HTMLButtonElement>('[data-retry-install]')!.click());
    expect(bridge.retryInstall).toHaveBeenCalledOnce();
    expect(text(body())).not.toContain('Existing skill at');
    expect($('[data-install-overview]')).toBeNull();
});

test('manual ticks wait while a global recovery is pending and become usable after failure', async () => {
    const target = targetAt('~/.agents/skills', true, {
        kind: 'agents',
        locked: true,
        skills: [{ name: 'lar-build', state: 'drift' }],
    });
    const drifted = {
        ...listed,
        targets: [target, targetAt('~/.claude-work/skills', false)],
        drift: [{ skill: 'lar-build', paths: [{ place: 'agents' as const, path: '~/.agents/skills/lar-build' }] }],
    };
    let finish!: (result: InstallOperationResult) => void;
    const bridge = stubApp({
        getInstallState: vi.fn(async () => drifted),
        replaceDrift: vi.fn(
            () =>
                new Promise<InstallOperationResult>((resolve) => {
                    finish = resolve;
                }),
        ),
        setTargetTick: vi.fn(),
    });

    await open();
    await settle(() =>
        row('target-~/.agents/skills').querySelector<HTMLButtonElement>('[data-replace-drift]')!.click(),
    );

    const control = switchOf('~/.claude-work/skills');

    expect(control.getAttribute('aria-disabled')).toBe('true');
    await settle(() => control.click());
    expect(bridge.setTargetTick).not.toHaveBeenCalled();
    await settle(() => finish({ snapshot: drifted, error: 'Copy failed' }));
    expect(control.getAttribute('aria-disabled')).toBe('false');
});
