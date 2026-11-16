import { assert, describe, it } from '@effect/vitest';
import type { InstallTarget, InstanceDiscovery, ProviderInstance } from '@lar-factory/shared/install-targets';
import * as Effect from 'effect/Effect';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';

import { makeBundle, tempDir } from '../../test/support.ts';
import * as SkillInstall from './skill-install.ts';

const launch = (overrides: Partial<SkillInstall.LaunchInput> = {}): SkillInstall.LaunchInput => ({
    isPackaged: true,
    version: '1.0.0',
    home: '/Users/someone',
    bundle: '/App/bundle',
    argv: [],
    env: {},
    ...overrides,
});

/** A T3 that isn't running. */
const outage: SkillInstall.Discover = () => Effect.succeed({ available: false, reason: 'not-running' });

/** A T3 that answers with one instance per list of targets, in the order given. */
const answering = (...targets: Array<Array<InstallTarget>>): InstanceDiscovery => ({
    available: true,
    instances: targets.map((list, index): ProviderInstance => ({
        id: `i${index}`,
        driver: 'claudeAgent',
        displayName: `I${index}`,
        enabled: true,
        targets: list,
    })),
});

/** A T3 whose answer `answer()` gives at each ask, so a test can change it between checks. */
const asking =
    (answer: () => InstanceDiscovery): SkillInstall.Discover =>
    () =>
        Effect.sync(answer);

/** Runs a launch's check at launch, or before a build, if it makes one, with T3 not running. */
const check = (input: SkillInstall.LaunchInput, at: 'atLaunch' | 'beforeBuild' = 'atLaunch') =>
    SkillInstall.makeChecks(input, outage).pipe(
        Effect.flatMap(
            (checks) => (at === 'atLaunch' ? checks?.atLaunch : checks?.beforeBuild()) ?? Effect.succeed(undefined),
        ),
    );

/** This launch's checks, which a packaged launch always makes. */
const checks = (input: SkillInstall.LaunchInput, discover: SkillInstall.Discover) =>
    SkillInstall.makeChecks(input, discover).pipe(Effect.map((made) => made!));

const read = (path: string) => NodeFS.readFileSync(path, 'utf8');

describe('makeChecks', () => {
    it.effect(
        'installs with the Claude profile’s links, then reports an edited skill as Drift on the next launch and leaves it',
        () =>
            Effect.gen(function* () {
                const home = tempDir('skill-home-');

                NodeFS.mkdirSync(NodePath.join(home, '.claude'));

                const input = launch({ home, bundle: makeBundle() });

                const first = yield* check(input);

                assert.strictEqual(first?.installed, true);
                assert.isTrue(NodeFS.existsSync(NodePath.join(home, '.agents/skills/lar-work/SKILL.md')));
                assert.isFalse(NodeFS.existsSync(NodePath.join(home, '.agents/references/checklist.md')));
                assert.isTrue(NodeFS.lstatSync(NodePath.join(home, '.claude/skills/lar-work')).isSymbolicLink());

                const second = yield* check(input);

                assert.strictEqual(second?.installed, false);

                NodeFS.writeFileSync(NodePath.join(home, '.agents/skills/lar-work/SKILL.md'), 'edited');

                const third = yield* check(input, 'beforeBuild');

                assert.strictEqual(third?.installed, false);
                assert.deepStrictEqual(
                    third?.drift.map(({ skill }) => skill),
                    ['lar-work'],
                );
                assert.strictEqual(SkillInstall.buildRefusal(third!), null);
                assert.strictEqual(
                    NodeFS.readFileSync(NodePath.join(home, '.agents/skills/lar-work/SKILL.md'), 'utf8'),
                    'edited',
                );
            }),
    );

    it.effect('asks before a build with Drift: Start anyway leaves the files, Replace and start overwrites them', () =>
        Effect.gen(function* () {
            const home = tempDir('skill-home-');
            const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);

            yield* made.atLaunch;

            const skill = NodePath.join(home, '.agents/skills/lar-work/SKILL.md');
            const bundled = read(skill);

            NodeFS.writeFileSync(skill, 'edited');

            const asked = SkillInstall.buildAnswer(yield* made.beforeBuild());

            assert.deepStrictEqual(asked.drift, ['lar-work']);
            assert.include(asked.refusal, 'lar-work');
            assert.strictEqual(read(skill), 'edited');

            assert.deepStrictEqual(SkillInstall.buildAnswer(yield* made.beforeBuild('keep'), 'keep'), {
                refusal: null,
            });
            assert.strictEqual(read(skill), 'edited');

            const replaced = yield* made.beforeBuild('replace');

            assert.deepStrictEqual(SkillInstall.buildAnswer(replaced, 'replace'), { refusal: null });
            assert.deepStrictEqual(replaced.replaced, ['lar-work']);
            assert.strictEqual(read(skill), bundled);
        }),
    );

    it.effect('writes nothing on a dev run without the flag', () =>
        Effect.gen(function* () {
            const home = tempDir('skill-home-');
            const result = yield* check(launch({ isPackaged: false, home, bundle: makeBundle() }));

            assert.strictEqual(result, undefined);
            assert.isFalse(NodeFS.existsSync(NodePath.join(home, '.agents')));
        }),
    );
});

describe('makeChecks with T3', () => {
    it.effect('installs into the fallback targets at launch without waiting for T3', () =>
        Effect.gen(function* () {
            const home = tempDir('skill-home-');

            NodeFS.mkdirSync(NodePath.join(home, '.claude'));

            const made = yield* checks(launch({ home, bundle: makeBundle() }), () => Effect.never);

            const outcome = yield* made.atLaunch;

            assert.strictEqual(outcome.installed, true);
            assert.isTrue(NodeFS.existsSync(NodePath.join(home, '.agents/skills/lar-work/SKILL.md')));
            assert.isTrue(NodeFS.lstatSync(NodePath.join(home, '.claude/skills/lar-work')).isSymbolicLink());
        }),
    );

    it.effect('installs into the targets T3 reports once it answers, and leaves the existing ones as they are', () =>
        Effect.gen(function* () {
            const home = tempDir('skill-home-');
            const work = NodePath.join(home, 'work-claude');

            NodeFS.mkdirSync(work);

            let answer: InstanceDiscovery = { available: false, reason: 'timed-out' };
            const made = yield* checks(
                launch({ home, bundle: makeBundle() }),
                asking(() => answer),
            );

            yield* made.atLaunch;
            assert.strictEqual(yield* made.afterDiscovery, undefined);
            NodeFS.writeFileSync(NodePath.join(home, '.agents/skills/lar-work/SKILL.md'), 'edited');

            answer = answering([{ kind: 'claude', path: NodePath.join(work, 'skills') }]);

            const found = yield* made.afterDiscovery;

            assert.isTrue(NodeFS.lstatSync(NodePath.join(work, 'skills/lar-work')).isSymbolicLink());
            assert.strictEqual(read(NodePath.join(work, 'skills/lar-work/SKILL.md')), 'edited');
            assert.deepStrictEqual(
                found?.drift.map(({ skill }) => skill),
                ['lar-work'],
            );

            const target = found?.targets.find(({ path }) => path === NodePath.join(work, 'skills'));

            assert.deepStrictEqual([target?.required, target?.active, target?.finished], [true, true, true]);
        }),
    );

    it.effect(
        'after a restart with T3 down, keeps installing into T3’s recorded targets and refuses a build on their Clash',
        () =>
            Effect.gen(function* () {
                const home = NodeFS.realpathSync(tempDir('skill-home-'));
                const work = NodePath.join(home, 'work-claude');

                NodeFS.mkdirSync(work);

                const before = yield* checks(
                    launch({ home, bundle: makeBundle() }),
                    asking(() => answering([{ kind: 'claude', path: NodePath.join(work, 'skills') }])),
                );

                yield* before.afterDiscovery;
                NodeFS.rmSync(NodePath.join(work, 'skills/lar-work'));
                NodeFS.mkdirSync(NodePath.join(work, 'skills/lar-work'));

                const after = yield* checks(launch({ home, bundle: makeBundle(), version: '2.0.0' }), outage);
                const target = after.state().targets.find(({ path }) => path === NodePath.join(work, 'skills'));

                assert.deepStrictEqual(target, { kind: 'claude', path: NodePath.join(work, 'skills'), required: true });

                const outcome = yield* after.atLaunch;
                const checked = outcome.targets.find(({ paths }) => paths.includes(NodePath.join(work, 'skills')));

                assert.deepStrictEqual([checked?.required, checked?.active], [true, true]);
                assert.include(SkillInstall.buildRefusal(outcome), NodePath.join(work, 'skills/lar-work'));
            }),
    );

    it.effect('runs a launch check and a build check that start together one after the other', () =>
        Effect.gen(function* () {
            const home = tempDir('skill-home-');
            const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);
            const [launched, built] = yield* Effect.all([made.atLaunch, made.beforeBuild()], {
                concurrency: 'unbounded',
            });

            assert.deepStrictEqual([launched.installed, built.installed], [true, false]);
        }),
    );
});

describe('buildAnswer', () => {
    const clean = {
        installed: false,
        version: '1.0.0',
        skills: ['lar-work'],
        conflicts: [],
        blocked: [],
        drift: [],
        replaced: [],
        warn: false,
        targets: [],
    };
    const drift = [
        {
            skill: 'tdd',
            paths: [
                { place: 'agents' as const, path: '/home/.agents/skills/tdd' },
                { place: 'agents' as const, path: '/work/skills/tdd' },
            ],
        },
        { skill: 'grill', paths: [{ place: 'agents' as const, path: '/home/.agents/skills/grill' }] },
    ];

    it('never offers Start anyway for a Clash or a failed install', () => {
        const blocked = [{ skill: 'grill', paths: [{ place: 'agents' as const, path: '/home/.agents/skills/grill' }] }];
        const failed = {
            kind: 'claude' as const,
            path: '/home/.claude/skills',
            paths: [],
            required: true,
            skills: [],
            active: true,
            finished: false,
            error: { message: 'EACCES', changed: true },
        };

        for (const outcome of [
            { ...clean, drift, blocked },
            { ...clean, drift, targets: [failed] },
            new SkillInstall.SkillInstallError({ message: 'EACCES', changed: false }),
        ]) {
            for (const choice of [undefined, 'keep' as const]) {
                const answer = SkillInstall.buildAnswer(outcome, choice);

                assert.isString(answer.refusal);
                assert.strictEqual(answer.drift, undefined);
            }
        }
    });
});
