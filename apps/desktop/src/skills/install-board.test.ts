import { assert, describe, it } from '@effect/vitest';
import type { InstallSnapshot } from '@lar-factory/shared';
import { installTargets, type InstanceDiscovery } from '@lar-factory/shared/install-targets';
import * as Effect from 'effect/Effect';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';

import { makeBundle, tempDir } from '../../test/support.ts';
import * as InstallBoard from './install-board.ts';
import * as SkillInstall from './skill-install.ts';

/** A throwaway home with two Claude profiles, ~/.claude and .claude-work. */
const makeHome = () => {
    const home = NodeFS.realpathSync(tempDir('board-home-'));

    NodeFS.mkdirSync(NodePath.join(home, '.claude'));
    NodeFS.mkdirSync(NodePath.join(home, '.claude-work'));

    return home;
};

const notRunning: InstanceDiscovery = { available: false, reason: 'not-running' };

/** A packaged launch's checks into `home` and the board over them, with T3 answering `answer()`. */
const launch = (home: string, answer: () => InstanceDiscovery = () => notRunning, root?: string) =>
    Effect.gen(function* () {
        const input = { home, version: '1.0.0', bundle: makeBundle() };
        const checks = (yield* SkillInstall.makeChecks(
            { ...input, isPackaged: true, argv: [], env: root ? { [SkillInstall.ROOT_ENV]: root } : {} },
            () => Effect.sync(answer),
        ))!;

        return { checks, board: InstallBoard.makeInstallBoard(input, checks) };
    });

const target = (snapshot: InstallSnapshot, path: string) =>
    snapshot.targets.find((candidate) => candidate.path === path);
const link = (home: string, profile: string) => NodePath.join(home, profile, 'skills/lar-work');

describe('fromBoard', () => {
    it("accepts only a frame on the board's origin", () => {
        const board = 'http://127.0.0.1:4319';

        assert.isTrue(InstallBoard.fromBoard('http://127.0.0.1:4319/?view=all', board));
        assert.isFalse(InstallBoard.fromBoard('http://127.0.0.1:4320/', board));
        assert.isFalse(InstallBoard.fromBoard('https://example.com/', board));
        assert.isFalse(InstallBoard.fromBoard(undefined, board));
        assert.isFalse(InstallBoard.fromBoard('not a url', board));
        assert.isFalse(InstallBoard.fromBoard('about:blank', ''));
    });
});

describe('snapshot', () => {
    it.effect('reads the same state after the page reopens, and sends each change to a subscriber', () =>
        Effect.gen(function* () {
            const home = makeHome();
            const { checks, board } = yield* launch(home);
            const sent: Array<InstallSnapshot> = [];
            const stop = board.subscribe((snapshot) => sent.push(snapshot));

            yield* checks.atLaunch;
            stop();

            const reopened = InstallBoard.makeInstallBoard({ home, version: '1.0.0', bundle: '' }, checks).snapshot();

            assert.deepStrictEqual(board.snapshot(), sent.at(-1));
            assert.deepStrictEqual(
                reopened.targets.map(({ path, active }) => [path, active]),
                board.snapshot().targets.map(({ path, active }) => [path, active]),
            );
            assert.strictEqual(sent[0]?.running, 'launch');
            assert.strictEqual(sent.at(-1)?.running, null);
            assert.isTrue(
                sent.some((snapshot) =>
                    target(snapshot, '~/.agents/skills')?.skills.some(({ state }) => state === 'installing'),
                ),
            );

            const snapshot = board.snapshot();

            assert.deepStrictEqual(
                [snapshot.installs, snapshot.installed, snapshot.discovery],
                [true, true, 'waiting'],
            );
            assert.deepStrictEqual(
                snapshot.targets.map(({ path, active, locked, release }) => [path, active, locked, release]),
                [
                    ['~/.agents/skills', true, true, '1.0.0'],
                    ['~/.claude/skills', true, false, '1.0.0'],
                    ['~/.claude-work/skills', false, false, undefined],
                ],
            );
            assert.deepStrictEqual(target(snapshot, '~/.claude/skills')?.skills, [
                { name: 'lar-work', state: 'installed' },
            ]);
            assert.deepStrictEqual(target(snapshot, '~/.claude-work/skills')?.skills, [
                { name: 'lar-work', state: 'missing' },
            ]);
        }),
    );

    it.effect("names T3's instances and the targets they read, and holds no environment or home", () =>
        Effect.gen(function* () {
            const home = makeHome();
            const settings = {
                config: { homePath: '~/.claude-work' },
                environment: [
                    { name: 'HOME', value: '/Users/hidden-home' },
                    { name: 'API_TOKEN', value: 'token-123' },
                ],
            };
            const answer = (): InstanceDiscovery => ({
                available: true,
                instances: [
                    {
                        id: 'work',
                        driver: 'claudeAgent',
                        displayName: 'Work',
                        enabled: false,
                        targets: installTargets('claudeAgent', home, settings),
                    },
                ],
            });
            const { checks, board } = yield* launch(home, answer);

            yield* checks.afterDiscovery;

            const snapshot = board.snapshot();

            assert.deepStrictEqual(snapshot.instances, [
                { id: 'work', driver: 'claudeAgent', displayName: 'Work', enabled: false },
            ]);
            assert.deepStrictEqual(target(snapshot, '~/.claude-work/skills')?.instances, ['work']);
            assert.deepStrictEqual(
                [target(snapshot, '~/.claude-work/skills')?.active, target(snapshot, '~/.claude-work/skills')?.locked],
                [true, true],
            );

            const text = JSON.stringify(snapshot);

            for (const hidden of [home, '/Users/hidden-home', 'token-123', 'API_TOKEN', 'environment', 'homePath'])
                assert.notInclude(text, hidden);
        }),
    );
});

describe('setTick', () => {
    it.effect('unticks a profile, removing its links, and ticks it back', () =>
        Effect.gen(function* () {
            const home = makeHome();
            const { checks, board } = yield* launch(home);

            yield* checks.atLaunch;

            const off = yield* Effect.promise(() => board.setTick('~/.claude/skills', false));

            assert.strictEqual(off.error, undefined);
            assert.deepStrictEqual(off.removed, { links: ['lar-work'], checklists: false });
            assert.deepStrictEqual(
                [target(off.snapshot, '~/.claude/skills')?.active, target(off.snapshot, '~/.claude/skills')?.selection],
                [false, 'unticked'],
            );
            assert.isFalse(NodeFS.existsSync(link(home, '.claude')));

            const on = yield* Effect.promise(() => board.setTick('~/.claude-work/skills', true));

            assert.strictEqual(target(on.snapshot, '~/.claude-work/skills')?.active, true);
            assert.isTrue(NodeFS.lstatSync(link(home, '.claude-work')).isSymbolicLink());
        }),
    );

    it.effect("refuses a path that isn't a listed target or a tick that isn't a boolean, and writes nothing", () =>
        Effect.gen(function* () {
            const home = makeHome();
            const { checks, board } = yield* launch(home);

            yield* checks.atLaunch;

            const manifest = NodePath.join(home, '.agents/.lar-factory-install.json');
            const before = NodeFS.readFileSync(manifest, 'utf8');

            NodeFS.mkdirSync(NodePath.join(home, 'other'));
            for (const path of ['~/other', '../.claude/skills', NodePath.join(home, '.claude/skills'), '', 1, null]) {
                const result = yield* Effect.promise(() => board.setTick(path, false));

                assert.include(result.error, 'is not an Install target', String(path));
            }

            const result = yield* Effect.promise(() => board.setTick('~/.claude/skills', 'no'));

            assert.include(result.error, 'true or false');
            assert.strictEqual(NodeFS.readFileSync(manifest, 'utf8'), before);
            assert.isTrue(NodeFS.existsSync(link(home, '.claude')));
        }),
    );
});
