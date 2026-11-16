import assert from 'node:assert/strict';
import fs, {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { onTestFinished, test, vi } from 'vite-plus/test';

import {
    INSTALL_MANIFEST,
    defaultTargets,
    describeTargets,
    installSkills,
    profileTargets,
    setTargetTick,
    type InstallResult,
    type RootOption,
    type TargetResult,
} from './install-skills.ts';

function temporary(): string {
    const path = realpathSync(mkdtempSync(join(tmpdir(), 'install-skills-')));

    onTestFinished(() => rmSync(path, { recursive: true, force: true }));

    return path;
}

/** Writes each `relative path: content` pair under a new bundle folder. */
function bundle(files: Record<string, string>): string {
    const root = temporary();

    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
    }

    return root;
}

const v1 = {
    'skills/lar-work/SKILL.md': 'lar-work v1',
    'skills/lar-work/scripts/status.sh': 'status v1',
    'skills/tdd/SKILL.md': 'tdd v1',
    'skills/lar-work/references/pr-checklist.md': 'pr v1',
    'skills/lar-work/references/review.md': 'review v1',
};

const v2 = {
    'skills/lar-work/SKILL.md': 'lar-work v2',
    'skills/lar-work/scripts/status.sh': 'status v2',
    'skills/tdd/SKILL.md': 'tdd v2',
    'skills/lar-work/references/pr-checklist.md': 'pr v2',
    'skills/lar-work/references/review.md': 'review v2',
};

/** Ticks or unticks the Claude profile `name` in `home`, as Settings does. */
function tickProfile(home: string, name: string, ticked: boolean, options: RootOption = {}) {
    return setTargetTick(home, join(home, name, 'skills'), ticked, { ...options, known: profileTargets(home) });
}

/** Each Claude profile in `home`, ticked when its skills folder is an active target of the default install. */
function profileTicks(home: string): { name: string; ticked: boolean }[] {
    const targets = describeTargets(home, defaultTargets(home), profileTargets(home));

    return profileTargets(home).map(({ path }) => ({
        name: basename(dirname(path)),
        ticked: targets.find((target) => target.paths.includes(path))?.active ?? false,
    }));
}

function read(home: string, path: string): string {
    return readFileSync(join(home, '.agents', path), 'utf8');
}

interface Target {
    kind: string;
    release?: string;
    finished: boolean;
    skills: string[];
    digests?: Record<string, string>;
    selection?: string;
    required?: true;
    references?: true;
}

/** The manifest with its targets keyed by their path in `home` and without their digests, which `digests` checks. */
function manifest(home: string): { targets: Record<string, Target>; [field: string]: unknown } {
    const { targets, ...rest } = JSON.parse(read(home, INSTALL_MANIFEST)) as { targets: Record<string, Target> };

    return {
        ...rest,
        targets: Object.fromEntries(
            Object.entries(targets).map(([path, { digests: _, ...state }]) => [relative(home, path), state]),
        ),
    };
}

function digests(home: string): Record<string, string> {
    return (JSON.parse(read(home, INSTALL_MANIFEST)) as { targets: Record<string, Target> }).targets[
        join(home, '.agents/skills')
    ]!.digests!;
}

/** A target's manifest entry after an install of `release` finished there. */
function finished(kind: string, release: string, skills: string[], extra: Partial<Target> = {}): Target {
    return { kind, release, finished: true, skills, ...extra };
}

/** The result for ~/.agents/skills in `home` after an install of `release` finished there. */
function agentsResult(home: string, release: string, skills = ['lar-work', 'tdd']) {
    const path = join(home, '.agents/skills');

    return { kind: 'agents', path, paths: [path], required: false, skills, active: true, release, finished: true };
}

/** The manifest status of skills installed with a Release. */
function matching(...skills: string[]): Record<string, { state: 'matching' }> {
    return Object.fromEntries(skills.map((skill) => [skill, { state: 'matching' }]));
}

const restoredAt = new Date('2026-10-26T09:00:00.000Z');
const now = () => restoredAt;

/** The manifest status of skills whose Drift an install overwrote at `restoredAt`. */
function replacedStatus(...skills: string[]): Record<string, { state: 'restored'; restoredAt: string }> {
    return Object.fromEntries(
        skills.map((skill) => [skill, { state: 'restored', restoredAt: restoredAt.toISOString() }]),
    );
}

test('a fresh install copies every skill and checklist and writes the manifest', () => {
    const home = temporary();
    const result = installSkills(home, bundle(v1), '1.0.0');

    assert.deepEqual(result, {
        installed: true,
        version: '1.0.0',
        skills: ['lar-work', 'tdd'],
        conflicts: [],
        blocked: [],
        drift: [],
        replaced: [],
        warn: false,
        targets: [
            agentsResult(home, '1.0.0'),
            {
                kind: 'claude',
                path: join(home, '.claude/skills'),
                paths: [join(home, '.claude/skills')],
                required: false,
                skills: [],
                active: false,
                finished: false,
                homeMissing: true,
            },
        ],
    });
    for (const [path, content] of Object.entries(v1)) {
        assert.equal(readFileSync(join(home, '.agents', path), 'utf8'), content);
        assert.ok(lstatSync(join(home, '.agents', path)).isFile(), `${path} is a real file`);
    }
    assert.ok(!lstatSync(join(home, '.agents/skills/tdd')).isSymbolicLink());
    assert.deepEqual(manifest(home), {
        version: '1.0.0',
        status: matching('lar-work', 'tdd'),
        targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) },
    });
    assert.ok(!existsSync(join(home, '.agents/.skill-lock.json')));
});

test('a new version replaces the copies, records the skills whose Drift it overwrote and leaves no temporary folders', () => {
    const home = temporary();

    installSkills(home, bundle(v1), '1.0.0');
    writeFileSync(join(home, '.agents/skills/tdd/stale.md'), 'stale');
    writeFileSync(join(home, '.agents/skills/lar-work/references/stale.md'), 'stale');

    const result = installSkills(home, bundle(v2), '1.1.0', { now });

    assert.deepEqual([result.installed, result.replaced, result.drift], [true, ['lar-work', 'tdd'], []]);
    assert.equal(read(home, 'skills/lar-work/scripts/status.sh'), 'status v2');
    assert.equal(read(home, 'skills/lar-work/references/pr-checklist.md'), 'pr v2');
    assert.ok(!existsSync(join(home, '.agents/skills/tdd/stale.md')));
    assert.ok(!existsSync(join(home, '.agents/skills/lar-work/references/stale.md')));
    assert.deepEqual(manifest(home), {
        version: '1.1.0',
        status: replacedStatus('lar-work', 'tdd'),
        targets: { '.agents/skills': finished('agents', '1.1.0', ['lar-work', 'tdd']) },
    });
    assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
    assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);
});

const restores = {
    'an edited file': (home: string) => writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited'),
};

/** The fs calls that change a file, a folder or a link. */
const writers = [
    'writeFileSync',
    'renameSync',
    'rmSync',
    'symlinkSync',
    'mkdirSync',
    'mkdtempSync',
    'cpSync',
    'chmodSync',
    'unlinkSync',
] as const;

/** Every write the fs calls in `writers` make while `run` runs, by call name. */
function writesDuring<T>(run: () => T): { result: T; writes: string[] } {
    const spies = writers.map((name) => vi.spyOn(fs, name));

    syncBuiltinESMExports();

    try {
        const result = run();

        return { result, writes: writers.filter((_, index) => spies[index]!.mock.calls.length > 0) };
    } finally {
        for (const spy of spies) spy.mockRestore();
        syncBuiltinESMExports();
    }
}

for (const [change, make] of Object.entries(restores)) {
    test(`the same version reports a skill with ${change} as Drift and writes nothing`, () => {
        const home = temporary();
        const source = bundle({ ...v1, 'skills/tdd/scripts/run.sh': 'run' });

        chmodSync(join(source, 'skills/tdd/scripts/run.sh'), 0o755);
        installSkills(home, source, '1.0.0');
        make(home);

        const before = read(home, INSTALL_MANIFEST);

        const { result, writes } = writesDuring(() => installSkills(home, source, '1.0.0', { now }));

        assert.deepEqual(writes, []);
        assert.deepEqual([result.installed, result.replaced], [false, []]);
        assert.deepEqual(result.drift, [
            { skill: 'tdd', paths: [{ place: 'agents', path: join(home, '.agents/skills/tdd') }] },
        ]);
        assert.equal(read(home, INSTALL_MANIFEST), before);
    });

    test(`Replace overwrites a skill with ${change} and records when`, () => {
        const home = temporary();
        const source = bundle({ ...v1, 'skills/tdd/scripts/run.sh': 'run' });

        chmodSync(join(source, 'skills/tdd/scripts/run.sh'), 0o755);
        installSkills(home, source, '1.0.0');
        make(home);

        const result = installSkills(home, source, '1.0.0', { now, replace: true });

        assert.deepEqual([result.installed, result.replaced, result.drift], [true, ['tdd'], []]);
        assert.deepEqual(readdirSync(join(home, '.agents/skills/tdd'), { recursive: true }).map(String).sort(), [
            'SKILL.md',
            'scripts',
            'scripts/run.sh',
        ]);
        assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
        assert.equal(lstatSync(join(home, '.agents/skills/tdd/scripts/run.sh')).mode & 0o777, 0o755);
        assert.deepEqual(manifest(home).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
    });
}

test('Replace overwrites owned Drift only and leaves a Clash as it is', () => {
    const home = geminiHome();
    const source = bundle(v1);

    writeSkill(home, 'tdd', 'tdd from the skills CLI');
    installSkills(home, source, '1.0.0');
    writeFileSync(join(home, '.agents/skills/lar-work/SKILL.md'), 'edited');
    writeFileSync(join(home, '.gemini/config/skills/lar-work/SKILL.md'), 'edited');

    const result = installSkills(home, source, '1.0.0', { now, replace: true });

    assert.deepEqual([result.replaced, result.conflicts], [['lar-work'], [join(home, '.agents/skills/tdd')]]);
    assert.equal(read(home, 'skills/lar-work/SKILL.md'), 'lar-work v1');
    assert.equal(readFileSync(join(home, '.gemini/config/skills/lar-work/SKILL.md'), 'utf8'), 'lar-work v1');
    assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd from the skills CLI');
});

/** Root reads unreadable files and deletes from read-only folders, so the tests that rely on either can't run as root. */
const runsAsRoot = process.getuid?.() === 0;

/** The error of the install into ~/.agents/skills, which a failure there records instead of throwing. */
function agentsError(result: InstallResult): TargetResult['error'] {
    return result.targets.find((target) => target.kind === 'agents')!.error;
}

test('skills and files outside the bundle are left alone', () => {
    const home = temporary();

    mkdirSync(join(home, '.agents/skills/other'), { recursive: true });
    writeFileSync(join(home, '.agents/skills/other/SKILL.md'), 'other');
    writeFileSync(join(home, '.agents/.skill-lock.json'), '{"lock":true}');

    installSkills(home, bundle(v1), '1.0.0');

    assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
    assert.equal(read(home, '.skill-lock.json'), '{"lock":true}');
});

test.skipIf(runsAsRoot)('a copy that fails partway keeps the previous version, and a later call succeeds', () => {
    const home = temporary();

    installSkills(home, bundle(v1), '1.0.0');

    const broken = bundle(v2);
    const unreadable = join(broken, 'skills/tdd/SKILL.md');

    chmodSync(unreadable, 0o000);

    assert.throws(() => installSkills(home, broken, '2.0.0'), /skill tdd/);

    for (const [path, content] of Object.entries(v1)) assert.equal(read(home, path), content);
    assert.deepEqual(manifest(home), {
        version: '1.0.0',
        status: matching('lar-work', 'tdd'),
        targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) },
    });
    assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
    assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);

    chmodSync(unreadable, 0o644);
    assert.equal(installSkills(home, broken, '2.0.0').installed, true);
    assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
    assert.deepEqual(manifest(home), {
        version: '2.0.0',
        status: matching('lar-work', 'tdd'),
        targets: { '.agents/skills': finished('agents', '2.0.0', ['lar-work', 'tdd']) },
    });
});

function writeSkill(home: string, name: string, content: string): void {
    mkdirSync(join(home, '.agents/skills', name), { recursive: true });
    writeFileSync(join(home, '.agents/skills', name, 'SKILL.md'), content);
}

const lock = '{\n  "version": 3,\n  "skills": { "other": {} }\n}\n';

for (const [kind, content] of [['an edited', 'tdd from the skills CLI']] as const) {
    test(`a first install leaves ${kind} same-named skill as a Clash and installs the rest`, () => {
        const home = temporary();

        writeSkill(home, 'tdd', content);
        writeSkill(home, 'other', 'other');
        writeFileSync(join(home, '.agents/.skill-lock.json'), lock);

        const result = installSkills(home, bundle(v1), '1.0.0');

        const clash = { place: 'agents' as const, path: join(home, '.agents/skills/tdd') };

        assert.deepEqual([result.conflicts, result.blocked], [[clash.path], [{ skill: 'tdd', paths: [clash] }]]);
        assert.equal(read(home, 'skills/tdd/SKILL.md'), content);
        assert.equal(read(home, 'skills/lar-work/SKILL.md'), 'lar-work v1');
        assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
        assert.deepEqual(manifest(home), {
            version: '1.0.0',
            status: { ...matching('lar-work'), tdd: { state: 'blocked', paths: [clash] } },
            warned: '1.0.0',
            targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work']) },
        });
        assert.equal(read(home, '.skill-lock.json'), lock);

        installSkills(home, bundle(v2), '2.0.0');
        assert.equal(read(home, 'skills/tdd/SKILL.md'), content);
    });
}

for (const [skill, changed] of [['tdd', true]] as const) {
    test(`a failed move of ${skill} puts its previous copy back, leaves no .previous folder and says changed is ${changed}`, () => {
        const home = temporary();

        installSkills(home, bundle(v1), '1.0.0');

        const target = join(home, `.agents/skills/${skill}`);
        const rename = fs.renameSync;
        const mocked = vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
            if (to === target && !String(from).endsWith('.previous'))
                throw Object.assign(new Error('EIO: move failed'), { code: 'EIO' });

            rename(from, to);
        });

        syncBuiltinESMExports();

        try {
            const error = agentsError(installSkills(home, bundle(v2), '2.0.0'));

            assert.deepEqual([error?.changed, error?.message.includes('EIO')], [changed, true]);
        } finally {
            mocked.mockRestore();
            syncBuiltinESMExports();
        }

        assert.equal(read(home, `skills/${skill}/SKILL.md`), `${skill} v1`);
        assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
        assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);
    });
}

test('a failed move whose restore also fails keeps the old copy in the .previous folder', () => {
    const home = temporary();

    installSkills(home, bundle(v1), '1.0.0');

    const target = join(home, '.agents/skills/lar-work');
    const rename = fs.renameSync;
    const mocked = vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
        if (to === target) throw Object.assign(new Error('EIO: move failed'), { code: 'EIO' });

        rename(from, to);
    });

    syncBuiltinESMExports();

    try {
        assert.equal(agentsError(installSkills(home, bundle(v2), '2.0.0'))?.changed, false);
    } finally {
        mocked.mockRestore();
        syncBuiltinESMExports();
    }

    const previous = readdirSync(join(home, '.agents/skills')).filter((entry) => entry.endsWith('.previous'));

    assert.deepEqual(
        previous.map((entry) => readFileSync(join(home, '.agents/skills', entry, 'SKILL.md'), 'utf8')),
        ['lar-work v1'],
    );
});

/** v1 with a checklist link in one skill, as the real skills have. */
const linked = {
    ...v1,
    'skills/lar-work/SKILL.md': 'See `references/review.md` and [the PR list](references/pr-checklist.md#top).',
};

function profile(home: string, name: string): string {
    mkdirSync(join(home, name), { recursive: true });

    return join(home, name);
}

/** Each entry in a profile's skills folder, with its link target or `folder`. */
function entries(home: string, name: string): Record<string, string> {
    const skills = join(home, name, 'skills');

    return Object.fromEntries(
        readdirSync(skills)
            .sort()
            .map((entry) => {
                const path = join(skills, entry);

                return [entry, lstatSync(path).isSymbolicLink() ? readlinkSync(path) : 'folder'];
            }),
    );
}

/** Every `../` path in a profile's skills, taken literally, names a file. */
function assertChecklistsResolve(home: string, name: string): void {
    const skills = join(home, name, 'skills');
    let count = 0;

    for (const skill of readdirSync(skills)) {
        for (const file of readdirSync(join(skills, skill), { recursive: true, encoding: 'utf8' })) {
            if (!file.endsWith('.md')) continue;

            const text = readFileSync(join(skills, skill, file), 'utf8');

            for (const [, path] of text.matchAll(/(?:`|\]\()((?:\.\.\/|references\/)[^`) ]*)/g)) {
                count++;

                const target = join(skills, skill, file, '..', path!.split('#')[0]!);

                assert.ok(lstatSync(target).isFile(), `${name}: ${path} resolves to ${target}`);
            }
        }
    }
    assert.ok(count > 0, `${name} has checklist links`);
}

/** The default targets and the `skills/` of each named profile in `home`, offered as a T3 discovery would. */
function withProfiles(home: string, ...names: string[]) {
    return {
        targets: [
            ...defaultTargets(home),
            ...names.map((name) => ({ kind: 'claude' as const, path: join(home, name, 'skills') })),
        ],
    };
}

const ownLinks = { 'lar-work': '../../.agents/skills/lar-work', tdd: '../../.agents/skills/tdd' };

test('a fresh install links every skill into ~/.claude, and ticking another profile links them there', () => {
    const home = temporary();

    profile(home, '.claude');
    profile(home, '.claude-work');
    profile(home, '.claudex');
    writeFileSync(join(home, '.claude-notes'), 'not a profile');

    const result = installSkills(home, bundle(linked), '1.0.0');

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(profileTicks(home), [
        { name: '.claude', ticked: true },
        { name: '.claude-work', ticked: false },
    ]);
    assert.ok(!existsSync(join(home, '.claude-work/skills')));
    tickProfile(home, '.claude-work', true);
    assert.deepEqual(profileTicks(home), [
        { name: '.claude', ticked: true },
        { name: '.claude-work', ticked: true },
    ]);
    for (const name of ['.claude', '.claude-work']) {
        assert.deepEqual(entries(home, name), ownLinks);
        assert.equal(readFileSync(join(home, name, 'skills/lar-work/references/review.md'), 'utf8'), 'review v1');
        assert.ok(!existsSync(join(home, name, 'references')));
        assertChecklistsResolve(home, name);
        assert.deepEqual(readdirSync(join(home, name)).sort(), ['skills']);
    }
    assert.ok(!existsSync(join(home, '.claudex/skills')));
    assert.deepEqual(manifest(home), {
        version: '1.0.0',
        status: matching('lar-work', 'tdd'),
        targets: {
            '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']),
            '.claude-work/skills': finished('claude', '1.0.0', ['lar-work', 'tdd'], { selection: 'ticked' }),
            '.claude/skills': finished('claude', '1.0.0', ['lar-work', 'tdd']),
        },
    });
});

test('unticking a profile removes only the engine links and checklists, and ticking restores them', () => {
    const home = temporary();

    profile(home, '.claude-work');
    installSkills(home, bundle(linked), '1.0.0');
    tickProfile(home, '.claude-work', true);
    mkdirSync(join(home, '.claude-work/skills/mine'));
    writeFileSync(join(home, '.claude-work/settings.json'), '{}');

    assert.deepEqual(tickProfile(home, '.claude-work', false), {
        conflicts: [],
        removed: { links: ['lar-work', 'tdd'], checklists: false },
    });

    assert.deepEqual(entries(home, '.claude-work'), { mine: 'folder' });
    assert.ok(!existsSync(join(home, '.claude-work/references')));
    assert.equal(readFileSync(join(home, '.claude-work/settings.json'), 'utf8'), '{}');
    assert.deepEqual(profileTicks(home), [{ name: '.claude-work', ticked: false }]);
    assert.ok(existsSync(join(home, '.agents/skills/tdd/SKILL.md')));

    assert.deepEqual(tickProfile(home, '.claude-work', true), {
        conflicts: [],
        removed: { links: [], checklists: false },
    });

    assert.deepEqual(entries(home, '.claude-work'), { ...ownLinks, mine: 'folder' });
    assertChecklistsResolve(home, '.claude-work');
    assert.deepEqual(profileTicks(home), [{ name: '.claude-work', ticked: true }]);
});
test('an entry the engine did not make is left in place and reported as a conflict', () => {
    const home = temporary();

    mkdirSync(join(home, '.claude/skills/tdd'), { recursive: true });
    writeFileSync(join(home, '.claude/skills/tdd/SKILL.md'), 'hand-made');
    mkdirSync(join(home, '.claude-work/skills'), { recursive: true });
    symlinkSync('../../elsewhere/lar-work', join(home, '.claude-work/skills/lar-work'));

    const result = installSkills(home, bundle(linked), '1.0.0', withProfiles(home, '.claude-work'));

    assert.deepEqual(result.conflicts, [join(home, '.claude/skills/tdd'), join(home, '.claude-work/skills/lar-work')]);
    assert.deepEqual(result.blocked, [
        {
            skill: 'lar-work',
            paths: [{ place: 'profile', profile: '.claude-work', path: join(home, '.claude-work/skills/lar-work') }],
        },
        { skill: 'tdd', paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }] },
    ]);
    assert.deepEqual(manifest(home).status, {
        'lar-work': {
            state: 'blocked',
            paths: [{ place: 'profile', profile: '.claude-work', path: join(home, '.claude-work/skills/lar-work') }],
        },
        tdd: {
            state: 'blocked',
            paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }],
        },
    });
    assert.deepEqual(entries(home, '.claude'), { 'lar-work': ownLinks['lar-work'], tdd: 'folder' });
    assert.equal(readFileSync(join(home, '.claude/skills/tdd/SKILL.md'), 'utf8'), 'hand-made');
    assert.deepEqual(entries(home, '.claude-work'), { 'lar-work': '../../elsewhere/lar-work', tdd: ownLinks.tdd });

    profile(home, '.claude-later');
    mkdirSync(join(home, '.claude-later/references'));
    writeFileSync(join(home, '.claude-later/references/mine.md'), 'mine');

    assert.deepEqual(tickProfile(home, '.claude-later', true), {
        conflicts: [],
        removed: { links: [], checklists: false },
    });
    assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');
    assert.deepEqual(entries(home, '.claude-later'), ownLinks);

    assert.deepEqual(tickProfile(home, '.claude-later', false), {
        conflicts: [],
        removed: { links: ['lar-work', 'tdd'], checklists: false },
    });
    assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');

    tickProfile(home, '.claude', false);

    assert.deepEqual(entries(home, '.claude'), { tdd: 'folder' });
});

/** Antigravity's skill folders in a home: the app's and the CLI's. */
const antigravity = ['.gemini/config/skills', '.gemini/antigravity-cli/skills'];

/** The skills the manifest records as owned in each Antigravity folder, or undefined for one it doesn't record. */
function antigravityOwned(home: string): (string[] | undefined)[] {
    return antigravity.map((folder) => manifest(home).targets[folder]?.skills);
}

function geminiHome(): string {
    const home = temporary();

    mkdirSync(join(home, '.gemini'));

    return home;
}

test('an install copies every skill into both Antigravity folders when ~/.gemini exists', () => {
    const home = geminiHome();
    const result = installSkills(home, bundle(v1), '1.0.0');

    assert.deepEqual(
        { ...result, targets: [] },
        {
            installed: true,
            version: '1.0.0',
            skills: ['lar-work', 'tdd'],
            conflicts: [],
            blocked: [],
            drift: [],
            replaced: [],
            warn: false,
            targets: [],
        },
    );
    assert.deepEqual(
        result.targets.map(({ path, active, finished }) => [relative(home, path), active, finished]),
        [
            ['.agents/skills', true, true],
            ['.claude/skills', false, false],
            ...antigravity.map((folder) => [folder, true, true]),
        ],
    );
    for (const folder of antigravity) {
        assert.ok(!lstatSync(join(home, folder, 'tdd')).isSymbolicLink(), `${folder}/tdd is a copy`);
        assert.equal(readFileSync(join(home, folder, 'lar-work/scripts/status.sh'), 'utf8'), 'status v1');
        assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work', 'tdd']);
    }
    assert.deepEqual(antigravityOwned(home), [
        ['lar-work', 'tdd'],
        ['lar-work', 'tdd'],
    ]);
    assert.equal(installSkills(home, bundle(v1), '1.0.0').installed, false);
});
test('a newly offered target gets the current Release without rewriting the targets already on it', () => {
    const home = temporary();
    const source = bundle(v1);

    installSkills(home, source, '1.0.0');
    writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');

    const before = {
        agents: lstatSync(join(home, '.agents/skills/lar-work')).ino,
        entry: manifest(home).targets['.agents/skills'],
    };

    mkdirSync(join(home, '.gemini'));

    const result = installSkills(home, source, '1.0.0');

    assert.deepEqual([result.installed, result.replaced], [true, []]);
    assert.deepEqual(result.drift, [
        { skill: 'tdd', paths: [{ place: 'agents', path: join(home, '.agents/skills/tdd') }] },
    ]);
    assert.equal(read(home, 'skills/tdd/SKILL.md'), 'edited');
    assert.equal(lstatSync(join(home, '.agents/skills/lar-work')).ino, before.agents);
    assert.deepEqual(manifest(home).targets['.agents/skills'], before.entry);
    for (const folder of antigravity) assert.equal(readFileSync(join(home, folder, 'tdd/SKILL.md'), 'utf8'), 'tdd v1');
    assert.deepEqual(antigravityOwned(home), [
        ['lar-work', 'tdd'],
        ['lar-work', 'tdd'],
    ]);
});

test('a legacy manifest becomes targets with its owned skills, Release, ticks, links and Antigravity copies', () => {
    const home = geminiHome();
    const source = bundle(linked);

    for (const name of ['.claude', '.claude-work', '.claude-off']) profile(home, name);
    // The files of a legacy install, which the engine before Install targets laid out the same way.
    installSkills(home, source, '1.0.0', withProfiles(home, '.claude-work'));
    mkdirSync(join(home, '.claude-work/references'));

    const recorded = digests(home);

    writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
    writeFileSync(
        join(home, '.agents', INSTALL_MANIFEST),
        JSON.stringify({
            version: '1.0.0',
            skills: ['lar-work', 'tdd'],
            digests: recorded,
            status: matching('lar-work', 'tdd'),
            warned: '0.9.0',
            profiles: {
                '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: false },
                '.claude-work': { ticked: true, links: ['lar-work', 'tdd'], references: true },
                '.claude-off': { ticked: false, links: [], references: false },
            },
            antigravity: Object.fromEntries(antigravity.map((folder) => [folder, ['lar-work', 'tdd']])),
        }),
    );

    assert.deepEqual(
        profileTicks(home),
        ['.claude', '.claude-off', '.claude-work'].map((name) => ({ name, ticked: name !== '.claude-off' })),
    );

    const same = installSkills(home, source, '1.0.0');

    assert.deepEqual([same.drift.map(({ skill }) => skill), same.conflicts], [['tdd'], []]);
    assert.deepEqual(manifest(home), {
        version: '1.0.0',
        status: matching('lar-work', 'tdd'),
        warned: '0.9.0',
        targets: {
            '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']),
            '.claude-off/skills': finished('claude', '1.0.0', [], { selection: 'unticked' }),
            '.claude-work/skills': finished('claude', '1.0.0', ['lar-work', 'tdd'], {
                selection: 'ticked',
                references: true,
            }),
            '.claude/skills': finished('claude', '1.0.0', ['lar-work', 'tdd'], { selection: 'ticked' }),
            ...Object.fromEntries(
                antigravity.map((folder) => [folder, finished('antigravity', '1.0.0', ['lar-work', 'tdd'])]),
            ),
        },
    });
    assert.deepEqual(digests(home), recorded);

    const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;
    const upgrade = installSkills(home, bundle(withoutTdd), '2.0.0', { now });

    assert.deepEqual(upgrade.replaced, []);
    assert.deepEqual(readdirSync(join(home, '.agents/skills')), ['lar-work']);
    for (const name of ['.claude', '.claude-work'])
        assert.deepEqual(entries(home, name), { 'lar-work': ownLinks['lar-work'] });
    for (const folder of antigravity) assert.deepEqual(readdirSync(join(home, folder)), ['lar-work']);
    assert.ok(!existsSync(join(home, '.claude-off/skills')));
    tickProfile(home, '.claude-work', false);
    assert.ok(!existsSync(join(home, '.claude-work/references')));
});

/** Every path in `folder` with its content or link target, without following links. */
function tree(folder: string, prefix = ''): string[] {
    return readdirSync(folder)
        .sort()
        .flatMap((entry) => {
            const path = join(folder, entry);
            const stats = lstatSync(path);

            if (stats.isSymbolicLink()) return [`${prefix}${entry} -> ${readlinkSync(path)}`];

            if (stats.isDirectory()) return [`${prefix}${entry}/`, ...tree(path, `${prefix}${entry}/`)];

            return [`${prefix}${entry}: ${readFileSync(path, 'utf8')}`];
        });
}

/** A folder outside `root` holding a Claude home with one User skill, and what is in it. */
function outsideHome(): { home: string; files: () => string[] } {
    const home = temporary();

    mkdirSync(join(home, 'skills/mine'), { recursive: true });
    writeFileSync(join(home, 'skills/mine/SKILL.md'), 'mine');

    return { home, files: () => tree(home) };
}

test('with a root, an offered target at an absolute home outside it fails before any write and the rest install', () => {
    const root = temporary();
    const outside = outsideHome();
    const before = outside.files();

    const result = installSkills(root, bundle(v1), '1.0.0', {
        root,
        targets: [...defaultTargets(root), { kind: 'claude', path: join(outside.home, 'skills'), required: true }],
    });

    assert.deepEqual(outside.files(), before);

    const rejected = result.targets.find(({ path }) => path === join(outside.home, 'skills'));

    assert.equal(rejected?.active, false);
    assert.match(rejected?.error?.message ?? '', /outside the install root/);
    assert.equal(rejected?.error?.changed, false);
    assert.deepEqual(result.skills, ['lar-work', 'tdd']);
    assert.deepEqual(Object.keys(manifest(root).targets), ['.agents/skills']);
});

test('with a root, an ~/.agents linked to outside it stops the install before any write', () => {
    const root = temporary();
    const outside = temporary();

    symlinkSync(outside, join(root, '.agents'));

    assert.throws(
        () => installSkills(root, bundle(v1), '1.0.0', { root }),
        (error: unknown) =>
            error instanceof Error &&
            /outside the install root/.test(error.message) &&
            (error as { changed?: boolean }).changed === false,
    );
    assert.deepEqual(readdirSync(outside), []);
});
