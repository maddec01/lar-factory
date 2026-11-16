import { assert, describe, it } from '@effect/vitest';
import type { UpdateChannel, UpdateState } from '@lar-factory/shared';
import * as Effect from 'effect/Effect';

import * as AppUpdates from './AppUpdates.ts';
import type { ChannelSetting } from './channel-setting.ts';
import { ElectronUpdaterError, type ElectronUpdater, type UpdaterEvent } from './ElectronUpdater.ts';

/** What a check, download or install of the fake updater does: emit events, fail, or wait. */
type Step = Effect.Effect<void, ElectronUpdaterError>;

/** An updater that records its settings and calls, and emits events as the test says. */
const makeFakeUpdater = () => {
    const listeners = new Map<UpdaterEvent, Set<(arg: unknown) => void>>();
    const fake = {
        channel: '' as string,
        allowPrerelease: false,
        allowDowngrade: false,
        fullChangelog: false,
        autoDownload: true,
        checks: 0,
        installs: 0,
        /** The board server's stops and starts and the installs, in order. */
        steps: [] as string[],
        onCheck: Effect.void as Step,
        onDownload: Effect.void as Step,
        onInstall: Effect.void as Step,
        emit: (eventName: UpdaterEvent, arg?: unknown) => {
            for (const listener of listeners.get(eventName) ?? []) listener(arg);
        },
        listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
    const updater: ElectronUpdater = {
        setAutoDownload: (value) => Effect.sync(() => void (fake.autoDownload = value)),
        setAutoInstallOnAppQuit: () => Effect.void,
        setChannel: (channel) => Effect.sync(() => void (fake.channel = channel)),
        setAllowPrerelease: (value) => Effect.sync(() => void (fake.allowPrerelease = value)),
        setFullChangelog: (value) => Effect.sync(() => void (fake.fullChangelog = value)),
        allowDowngrade: Effect.sync(() => fake.allowDowngrade),
        setAllowDowngrade: (value) => Effect.sync(() => void (fake.allowDowngrade = value)),
        checkForUpdates: Effect.suspend(() => {
            fake.checks += 1;

            return fake.onCheck;
        }),
        downloadUpdate: Effect.suspend(() => fake.onDownload),
        quitAndInstall: () =>
            Effect.suspend(() => {
                fake.installs += 1;
                fake.steps.push('install');

                return fake.onInstall;
            }),
        on: (eventName, listener) =>
            Effect.acquireRelease(
                Effect.sync(() => {
                    const set = listeners.get(eventName) ?? new Set();

                    set.add(listener);
                    listeners.set(eventName, set);
                }),
                () => Effect.sync(() => void listeners.get(eventName)?.delete(listener)),
            ),
    };

    return { fake, updater };
};

/** A channel setting kept in memory, which a test can hand to a second `make` as after a restart. */
const makeChannelSetting = (saved: UpdateChannel | null = null) => {
    const setting: ChannelSetting & { saved: UpdateChannel | null } = {
        saved,
        read: Effect.sync(() => setting.saved),
        write: (channel: UpdateChannel) => Effect.sync(() => void (setting.saved = channel)),
    };

    return setting;
};

const setup = (options: { version?: string; disabledReason?: string | null; channelSetting?: ChannelSetting } = {}) =>
    Effect.gen(function* () {
        const { fake, updater } = makeFakeUpdater();
        const board: AppUpdates.BoardServerControl & { onStop: Effect.Effect<void, Error> } = {
            onStop: Effect.void,
            stop: Effect.suspend(() => {
                fake.steps.push('stop');

                return board.onStop;
            }),
            start: Effect.sync(() => void fake.steps.push('start')),
        };
        const published: UpdateState[] = [];
        const updates = yield* AppUpdates.make({
            updater,
            board,
            version: options.version ?? '0.1.0',
            disabledReason: options.disabledReason === undefined ? null : options.disabledReason,
            channelSetting: options.channelSetting ?? makeChannelSetting(),
            publish: (state) => published.push(state),
        });
        const statuses = () => published.map((state) => state.status);

        return { fake, board, updates, published, statuses };
    });

const failure = (operation: 'check' | 'download' | 'install', message: string, code?: string) =>
    Effect.fail(new ElectronUpdaterError({ operation, cause: Object.assign(new Error(message), code && { code }) }));

describe('AppUpdates', () => {
    it.effect('reports a newer version as available, and one of the other channel as up to date', () =>
        Effect.gen(function* () {
            const { fake, updates } = yield* setup();

            fake.onCheck = Effect.sync(() => fake.emit('update-available', { version: '0.3.0' }));

            const available = yield* updates.check;

            assert.strictEqual(available.state.status, 'available');
            assert.strictEqual(available.state.availableVersion, '0.3.0');

            fake.onCheck = Effect.sync(() => fake.emit('update-available', { version: '0.4.0-nightly.20261024.50' }));

            const otherChannel = yield* updates.check;

            assert.strictEqual(otherChannel.state.status, 'up-to-date');
            assert.isNull(otherChannel.state.availableVersion);
        }).pipe(Effect.scoped),
    );

    it.effect('downloads an available update with progress, then installs it', () =>
        Effect.gen(function* () {
            const { fake, updates, published } = yield* setup();

            fake.onCheck = Effect.sync(() => fake.emit('update-available', { version: '0.3.0' }));
            yield* updates.check;
            fake.onDownload = Effect.sync(() => {
                for (const percent of [3, 7, 12, 55, 100]) fake.emit('download-progress', { percent });
                fake.emit('update-downloaded', { version: '0.3.0' });
            });

            const download = yield* updates.download;

            assert.isTrue(download.accepted);
            assert.isTrue(download.completed);
            assert.strictEqual(download.state.status, 'downloaded');
            assert.strictEqual(download.state.downloadedVersion, '0.3.0');

            // Progress reaches the page once per 10 % step.
            const percents = published
                .filter((state) => state.status === 'downloading')
                .map((state) => state.downloadPercent);

            assert.deepStrictEqual(percents, [0, 12, 55, 100]);

            const install = yield* updates.install;

            assert.isTrue(install.accepted);
            // The board server drains and stops before the install, as T3 Code stops its backends.
            assert.deepStrictEqual(fake.steps, ['stop', 'install']);
        }).pipe(Effect.scoped),
    );

    it.effect('keeps the update available after a failed download, and downloaded after a failed install', () =>
        Effect.gen(function* () {
            const { fake, updates } = yield* setup();

            fake.onCheck = Effect.sync(() => fake.emit('update-available', { version: '0.3.0' }));
            yield* updates.check;
            fake.onDownload = failure('download', 'disk full');

            const download = yield* updates.download;

            assert.strictEqual(download.state.status, 'available');
            assert.strictEqual(download.state.errorContext, 'download');
            assert.isTrue(download.state.canRetry);

            fake.onDownload = Effect.sync(() => fake.emit('update-downloaded', { version: '0.3.0' }));
            yield* updates.download;
            fake.onInstall = failure('install', 'not signed');

            const install = yield* updates.install;

            assert.strictEqual(install.state.status, 'downloaded');
            assert.strictEqual(install.state.errorContext, 'install');
            assert.isTrue(install.state.canRetry);
            // The failed install starts the board server again and no longer holds the updater: a retry goes through.
            assert.deepStrictEqual(fake.steps, ['stop', 'install', 'start']);
            fake.onInstall = Effect.void;
            assert.isTrue((yield* updates.install).accepted);
            assert.deepStrictEqual(fake.steps, ['stop', 'install', 'start', 'stop', 'install']);
        }).pipe(Effect.scoped),
    );

    it.effect("installs nothing when the board server won't drain, and starts it again", () =>
        Effect.gen(function* () {
            const { fake, board, updates } = yield* setup();

            fake.onCheck = Effect.sync(() => fake.emit('update-available', { version: '0.3.0' }));
            yield* updates.check;
            fake.onDownload = Effect.sync(() => fake.emit('update-downloaded', { version: '0.3.0' }));
            yield* updates.download;
            board.onStop = Effect.fail(new Error("could not drain the board's writes: timed out"));

            const install = yield* updates.install;

            assert.strictEqual(install.state.status, 'downloaded');
            assert.strictEqual(install.state.errorContext, 'install');
            assert.strictEqual(install.state.message, "could not drain the board's writes: timed out");
            assert.deepStrictEqual(fake.steps, ['stop', 'start']);
            board.onStop = Effect.void;

            // The retry answers without the old failure, which the page would read as the retry failing.
            const retry = yield* updates.install;

            assert.isTrue(retry.accepted);
            assert.isNull(retry.state.errorContext);
            assert.isNull(retry.state.message);
            assert.deepStrictEqual(fake.steps, ['stop', 'start', 'stop', 'install']);
        }).pipe(Effect.scoped),
    );

    it.effect('keeps no downgrade on latest after a switch from nightly', () =>
        Effect.gen(function* () {
            const { fake, updates } = yield* setup({ version: '0.2.0-nightly.20261023.41' });

            assert.isTrue(fake.allowDowngrade);

            let downgradeDuringCheck = false;

            fake.onCheck = Effect.sync(() => {
                downgradeDuringCheck = fake.allowDowngrade;
                fake.emit('update-not-available');
            });

            const state = yield* updates.setChannel('latest');

            assert.strictEqual(state.channel, 'latest');
            assert.strictEqual(fake.channel, 'latest');
            assert.isTrue(downgradeDuringCheck);
            assert.isFalse(fake.allowDowngrade);
            assert.isFalse(fake.allowPrerelease);
        }).pipe(Effect.scoped),
    );

    it.effect('starts on the saved channel, saves a switch, and keeps it after a restart', () =>
        Effect.gen(function* () {
            const channelSetting = makeChannelSetting('latest');
            const first = yield* setup({ version: '0.2.0-nightly.20261023.41', channelSetting });

            assert.strictEqual((yield* first.updates.getState).channel, 'latest');
            assert.strictEqual(first.fake.channel, 'latest');

            yield* first.updates.setChannel('nightly');
            assert.strictEqual(channelSetting.saved, 'nightly');

            const restarted = yield* setup({ version: '0.2.0', channelSetting });

            assert.strictEqual((yield* restarted.updates.getState).channel, 'nightly');
            assert.strictEqual(restarted.fake.channel, 'nightly');
        }).pipe(Effect.scoped),
    );
});
