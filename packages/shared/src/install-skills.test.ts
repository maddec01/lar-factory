import { onTestFinished, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { INSTALL_MANIFEST, defaultTargets, installSkills, listClaudeProfiles, readSkillStatus, setProfileTick, type InstallResult, type TargetResult } from './install-skills.ts';

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

function read(home: string, path: string): string {
  return readFileSync(join(home, '.agents', path), 'utf8');
}

interface Target { kind: string; release?: string; finished: boolean; skills: string[]; digests?: Record<string, string>; selection?: string; references?: true }

/** The manifest with its targets keyed by their path in `home` and without their digests, which `digests` checks. */
function manifest(home: string): { targets: Record<string, Target>; [field: string]: unknown } {
  const { targets, ...rest } = JSON.parse(read(home, INSTALL_MANIFEST)) as { targets: Record<string, Target> };
  return { ...rest, targets: Object.fromEntries(Object.entries(targets).map(([path, { digests: _, ...state }]) => [relative(home, path), state])) };
}

function digests(home: string): Record<string, string> {
  return (JSON.parse(read(home, INSTALL_MANIFEST)) as { targets: Record<string, Target> }).targets[join(home, '.agents/skills')]!.digests!;
}

/** A target's manifest entry after an install of `release` finished there. */
function finished(kind: string, release: string, skills: string[], extra: Partial<Target> = {}): Target {
  return { kind, release, finished: true, skills, ...extra };
}

/** The result for ~/.agents/skills in `home` after an install of `release` finished there. */
function agentsResult(home: string, release: string) {
  const path = join(home, '.agents/skills');
  return { kind: 'agents', path, paths: [path], required: false, active: true, release, finished: true };
}

/** The manifest status of skills installed with a Release. */
function matching(...skills: string[]): Record<string, { state: 'matching' }> {
  return Object.fromEntries(skills.map((skill) => [skill, { state: 'matching' }]));
}

const restoredAt = new Date('2026-10-26T09:00:00.000Z');
const now = () => restoredAt;

/** The manifest status of skills whose Drift an install overwrote at `restoredAt`. */
function replacedStatus(...skills: string[]): Record<string, { state: 'restored'; restoredAt: string }> {
  return Object.fromEntries(skills.map((skill) => [skill, { state: 'restored', restoredAt: restoredAt.toISOString() }]));
}

test('a fresh install copies every skill and checklist and writes the manifest', () => {
  const home = temporary();
  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result, {
    installed: true, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false,
    targets: [agentsResult(home, '1.0.0'), { kind: 'claude', path: join(home, '.claude/skills'), paths: [join(home, '.claude/skills')], required: false, active: false, finished: false }],
  });
  for (const [path, content] of Object.entries(v1)) {
    assert.equal(readFileSync(join(home, '.agents', path), 'utf8'), content);
    assert.ok(lstatSync(join(home, '.agents', path)).isFile(), `${path} is a real file`);
  }
  assert.ok(!lstatSync(join(home, '.agents/skills/tdd')).isSymbolicLink());
  assert.deepEqual(manifest(home), {
    version: '1.0.0', status: matching('lar-work', 'tdd'), targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) },
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
    version: '1.1.0', status: replacedStatus('lar-work', 'tdd'), targets: { '.agents/skills': finished('agents', '1.1.0', ['lar-work', 'tdd']) },
  });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);
});

const restores = {
  'an edited file': (home: string) => writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited'),
  'a deleted file': (home: string) => rmSync(join(home, '.agents/skills/tdd/SKILL.md')),
  'an added file': (home: string) => writeFileSync(join(home, '.agents/skills/tdd/extra.md'), 'extra'),
  'a script that lost its executable bit': (home: string) => chmodSync(join(home, '.agents/skills/tdd/scripts/run.sh'), 0o644),
};

/** The fs calls that change a file, a folder or a link. */
const writers = ['writeFileSync', 'renameSync', 'rmSync', 'symlinkSync', 'mkdirSync', 'mkdtempSync', 'cpSync', 'chmodSync', 'unlinkSync'] as const;

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
    assert.deepEqual(result.drift, [{ skill: 'tdd', paths: [{ place: 'agents', path: join(home, '.agents/skills/tdd') }] }]);
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
    assert.deepEqual(readdirSync(join(home, '.agents/skills/tdd'), { recursive: true }).sort(), ['SKILL.md', 'scripts', 'scripts/run.sh']);
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

test('the same version reports a deleted skill as Drift, and a new version puts it back and records it', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  rmSync(join(home, '.agents/skills/tdd'), { recursive: true });

  const same = installSkills(home, bundle(v1), '1.0.0');
  assert.deepEqual([same.installed, same.drift], [false, [{ skill: 'tdd', paths: [{ place: 'agents', path: join(home, '.agents/skills/tdd') }] }]]);
  assert.ok(!existsSync(join(home, '.agents/skills/tdd')));

  const upgrade = installSkills(home, bundle(v2), '2.0.0', { now });
  assert.deepEqual([upgrade.replaced, upgrade.drift], [['tdd'], []]);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
});

test('a new version records no Drift for copies that still match their Release, or that a manifest without digests owns', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  assert.deepEqual(Object.keys(digests(home)), ['lar-work', 'tdd']);
  assert.equal(installSkills(home, bundle(v2), '2.0.0').replaced.length, 0);

  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '2.0.0', skills: ['lar-work', 'tdd'] }));
  const result = installSkills(home, bundle(v1), '3.0.0');


  assert.deepEqual(result.replaced, []);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

test('a replaced skill keeps its time while it matches, and a later version without Drift makes it matching', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
  installSkills(home, bundle(v1), '1.0.0', { now, replace: true });

  assert.equal(installSkills(home, bundle(v1), '1.0.0').installed, false);
  assert.deepEqual(manifest(home).status, { ...matching('lar-work'), ...replacedStatus('tdd') });

  installSkills(home, bundle(v2), '2.0.0');
  assert.deepEqual(manifest(home).status, matching('lar-work', 'tdd'));
});

test('readSkillStatus gives each skill’s state from the last install, and null before any install', () => {
  const home = temporary();
  assert.equal(readSkillStatus(home), null);
  installSkills(home, bundle(v1), '1.0.0');
  assert.deepEqual(readSkillStatus(home), matching('lar-work', 'tdd'));
});

test('an install that already matches writes nothing, not even the manifest', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-off');
  mkdirSync(join(home, '.gemini'));
  const source = bundle(linked);
  installSkills(home, source, '1.0.0');
  setProfileTick(home, '.claude-off', false);
  installSkills(home, source, '1.0.0');

  const { result, writes } = writesDuring(() => installSkills(home, source, '1.0.0', { now }));

  assert.equal(result.installed, false);
  assert.deepEqual(writes, []);
});

/** Root reads unreadable files and deletes from read-only folders, so the tests that rely on either can't run as root. */
const runsAsRoot = process.getuid?.() === 0;

/** The error of the install into ~/.agents/skills, which a failure there records instead of throwing. */
function agentsError(result: InstallResult): TargetResult['error'] {
  return result.targets.find((target) => target.kind === 'agents')!.error;
}

/** Matches the engine's InstallError whose `changed` is `changed`. */
const installError = (changed: boolean) => (error: unknown) =>
  error instanceof Error && error.name === 'InstallError' && (error as Error & { changed: boolean }).changed === changed;

test.skipIf(runsAsRoot)('a failed copy says nothing changed yet', () => {
  const broken = bundle(v1);
  chmodSync(join(broken, 'skills/lar-work/references/review.md'), 0o000);

  assert.throws(() => installSkills(temporary(), broken, '1.0.0'), installError(false));
});

test('a bundle without a skills folder says nothing changed and keeps the manifest', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  const before = read(home, INSTALL_MANIFEST);

  assert.throws(() => installSkills(home, bundle({ 'references/review.md': 'review v2' }), '2.0.0'), installError(false));
  assert.equal(read(home, INSTALL_MANIFEST), before);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

test('a manifest that is not valid JSON fails with its path and changes nothing', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), '{ not json');

  assert.throws(() => installSkills(home, bundle(v2), '2.0.0'),
    (error) => installError(false)(error) && (error as Error).message.includes(join(home, '.agents', INSTALL_MANIFEST)));
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

test('manifest skill names that are not one folder name are ignored', () => {
  const home = temporary();
  const outside = join(home, 'outside');
  mkdirSync(outside);
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '1.0.0', skills: ['lar-work', 'tdd', '../../outside', '..', '.', '', 'a/b', 3] }));

  installSkills(home, bundle(v2), '2.0.0');

  assert.ok(existsSync(outside));
  assert.ok(existsSync(join(home, '.agents/skills')));
  assert.deepEqual(manifest(home).targets['.agents/skills']!.skills, ['lar-work', 'tdd']);
});

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
  assert.deepEqual(manifest(home), { version: '1.0.0', status: matching('lar-work', 'tdd'), targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) } });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);

  chmodSync(unreadable, 0o644);
  assert.equal(installSkills(home, broken, '2.0.0').installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', status: matching('lar-work', 'tdd'), targets: { '.agents/skills': finished('agents', '2.0.0', ['lar-work', 'tdd']) } });
});

test.skipIf(runsAsRoot)('a failed checklist copy names the references folder', () => {
  const home = temporary();
  const broken = bundle(v1);
  const unreadable = join(broken, 'skills/lar-work/references/review.md');
  chmodSync(unreadable, 0o000);

  assert.throws(() => installSkills(home, broken, '1.0.0'), /skill lar-work/);
  assert.ok(!existsSync(join(home, '.agents', INSTALL_MANIFEST)));
});

function writeSkill(home: string, name: string, content: string): void {
  mkdirSync(join(home, '.agents/skills', name), { recursive: true });
  writeFileSync(join(home, '.agents/skills', name, 'SKILL.md'), content);
}

const lock = '{\n  "version": 3,\n  "skills": { "other": {} }\n}\n';

for (const [kind, content] of [['an edited', 'tdd from the skills CLI'], ['a matching', 'tdd v1']] as const) {
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
      version: '1.0.0', status: { ...matching('lar-work'), tdd: { state: 'blocked', paths: [clash] } }, warned: '1.0.0',
      targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work']) },
    });
    assert.equal(read(home, '.skill-lock.json'), lock);

    installSkills(home, bundle(v2), '2.0.0');
    assert.equal(read(home, 'skills/tdd/SKILL.md'), content);
  });
}

test('an upgrade whose bundle drops a skill removes its copy, edited or not, and its manifest entry', () => {
  const home = temporary();
  writeSkill(home, 'other', 'other');
  writeFileSync(join(home, '.agents/.skill-lock.json'), lock);
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = v2;

  const result = installSkills(home, bundle(withoutTdd), '2.0.0');

  assert.deepEqual(result, {
    installed: true, version: '2.0.0', skills: ['lar-work'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false,
    targets: [agentsResult(home, '2.0.0'), { kind: 'claude', path: join(home, '.claude/skills'), paths: [join(home, '.claude/skills')], required: false, active: false, finished: false }],
  });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'other']);
  assert.deepEqual(manifest(home), { version: '2.0.0', status: matching('lar-work'), targets: { '.agents/skills': finished('agents', '2.0.0', ['lar-work']) } });
  assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test.skipIf(runsAsRoot)('a swap that fails partway removes the staged copies left and says files changed', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  // A read-only first skill folder moves aside but can't be deleted, so its swap throws.
  const locked = join(home, '.agents/skills/lar-work');
  chmodSync(locked, 0o500);

  assert.equal(agentsError(installSkills(home, bundle(v2), '2.0.0'))?.changed, true);
  for (const entry of readdirSync(join(home, '.agents/skills'))) chmodSync(join(home, '.agents/skills', entry), 0o700);

  const staged = [join(home, '.agents'), join(home, '.agents/skills')]
    .flatMap((folder) => readdirSync(folder))
    .filter((entry) => entry.includes('.installing-') && !entry.endsWith('.previous'));
  assert.deepEqual(staged, []);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

for (const [skill, changed] of [['lar-work', false], ['tdd', true]] as const) {
  test(`a failed move of ${skill} puts its previous copy back, leaves no .previous folder and says changed is ${changed}`, () => {
    const home = temporary();
    installSkills(home, bundle(v1), '1.0.0');
    const target = join(home, `.agents/skills/${skill}`);
    const rename = fs.renameSync;
    const mocked = vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
      if (to === target && !String(from).endsWith('.previous')) throw Object.assign(new Error('EIO: move failed'), { code: 'EIO' });
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
  assert.deepEqual(previous.map((entry) => readFileSync(join(home, '.agents/skills', entry, 'SKILL.md'), 'utf8')), ['lar-work v1']);
});

test('a skill the engine did not install survives installs and upgrades', () => {
  const home = temporary();
  writeSkill(home, 'other', 'other');
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'later', 'later');
  installSkills(home, bundle(v2), '2.0.0');
  installSkills(home, bundle({ 'skills/lar-work/SKILL.md': 'v3', 'skills/lar-work/references/review.md': 'v3' }), '3.0.0');

  assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
  assert.equal(read(home, 'skills/later/SKILL.md'), 'later');
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'later', 'other']);
});

test('after the first install, a same-named folder the engine did not install is a conflict and stays', () => {
  const home = temporary();
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents/.skill-lock.json'), lock);
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'grill', 'grill from the skills CLI');

  const result = installSkills(home, bundle({ ...v2, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  assert.deepEqual({ ...result, targets: [] }, {
    installed: true, version: '2.0.0', skills: ['lar-work', 'tdd'], conflicts: [join(home, '.agents/skills/grill')],
    blocked: [{ skill: 'grill', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }], drift: [], replaced: [], warn: true, targets: [],
  });
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill from the skills CLI');
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), {
    version: '2.0.0', status: { grill: { state: 'blocked', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }, ...matching('lar-work', 'tdd') },
    warned: '2.0.0', targets: { '.agents/skills': finished('agents', '2.0.0', ['lar-work', 'tdd']) },
  });
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test('a bundled skill new to an upgrade installs when nothing holds its name', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');

  const result = installSkills(home, bundle({ ...v2, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  assert.deepEqual(result.conflicts, []);
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill v2');
  assert.deepEqual(manifest(home), {
    version: '2.0.0', status: matching('grill', 'lar-work', 'tdd'), targets: { '.agents/skills': finished('agents', '2.0.0', ['grill', 'lar-work', 'tdd']) },
  });
});

/** v1 with a checklist link in one skill, as the real skills have. */
const linked = { ...v1, 'skills/lar-work/SKILL.md': 'See `references/review.md` and [the PR list](references/pr-checklist.md#top).' };

function profile(home: string, name: string): string {
  mkdirSync(join(home, name), { recursive: true });
  return join(home, name);
}

/** Each entry in a profile's skills folder, with its link target or `folder`. */
function entries(home: string, name: string): Record<string, string> {
  const skills = join(home, name, 'skills');
  return Object.fromEntries(readdirSync(skills).sort().map((entry) => {
    const path = join(skills, entry);
    return [entry, lstatSync(path).isSymbolicLink() ? readlinkSync(path) : 'folder'];
  }));
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
  return { targets: [...defaultTargets(home), ...names.map((name) => ({ kind: 'claude' as const, path: join(home, name, 'skills') }))] };
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
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: false }]);
  assert.ok(!existsSync(join(home, '.claude-work/skills')));
  setProfileTick(home, '.claude-work', true);
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: true }]);
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
  setProfileTick(home, '.claude-work', true);
  mkdirSync(join(home, '.claude-work/skills/mine'));
  writeFileSync(join(home, '.claude-work/settings.json'), '{}');

  assert.deepEqual(setProfileTick(home, '.claude-work', false), { conflicts: [], removed: { links: ['lar-work', 'tdd'], checklists: false } });

  assert.deepEqual(entries(home, '.claude-work'), { mine: 'folder' });
  assert.ok(!existsSync(join(home, '.claude-work/references')));
  assert.equal(readFileSync(join(home, '.claude-work/settings.json'), 'utf8'), '{}');
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude-work', ticked: false }]);
  assert.ok(existsSync(join(home, '.agents/skills/tdd/SKILL.md')));

  assert.deepEqual(setProfileTick(home, '.claude-work', true), { conflicts: [], removed: { links: [], checklists: false } });

  assert.deepEqual(entries(home, '.claude-work'), { ...ownLinks, mine: 'folder' });
  assertChecklistsResolve(home, '.claude-work');
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude-work', ticked: true }]);
});

test('a profile that appears after the first install starts unticked with no links', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  profile(home, '.claude-later');

  installSkills(home, bundle(linked), '2.0.0');

  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude', ticked: true }, { name: '.claude-later', ticked: false }]);
  assert.deepEqual(readdirSync(join(home, '.claude-later')), []);
  assert.deepEqual(Object.keys(manifest(home).targets), ['.agents/skills', '.claude/skills']);

  setProfileTick(home, '.claude-later', true);

  assert.deepEqual(entries(home, '.claude-later'), ownLinks);
  assertChecklistsResolve(home, '.claude-later');
});

test('a first install leaves a link to the right skill folder as a Clash', () => {
  const home = temporary();
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  symlinkSync(join(home, '.agents/skills/tdd'), join(home, '.claude/skills/tdd'));

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.blocked, [{ skill: 'tdd', paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }] }]);
  assert.deepEqual(entries(home, '.claude'), { ...ownLinks, tdd: join(home, '.agents/skills/tdd') });

  setProfileTick(home, '.claude', false);

  assert.deepEqual(entries(home, '.claude'), { tdd: join(home, '.agents/skills/tdd') });
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
    { skill: 'lar-work', paths: [{ place: 'profile', profile: '.claude-work', path: join(home, '.claude-work/skills/lar-work') }] }, { skill: 'tdd', paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }] },
  ]);
  assert.deepEqual(manifest(home).status, {
    'lar-work': { state: 'blocked', paths: [{ place: 'profile', profile: '.claude-work', path: join(home, '.claude-work/skills/lar-work') }] },
    tdd: { state: 'blocked', paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }] },
  });
  assert.deepEqual(entries(home, '.claude'), { 'lar-work': ownLinks['lar-work'], tdd: 'folder' });
  assert.equal(readFileSync(join(home, '.claude/skills/tdd/SKILL.md'), 'utf8'), 'hand-made');
  assert.deepEqual(entries(home, '.claude-work'), { 'lar-work': '../../elsewhere/lar-work', tdd: ownLinks.tdd });

  profile(home, '.claude-later');
  mkdirSync(join(home, '.claude-later/references'));
  writeFileSync(join(home, '.claude-later/references/mine.md'), 'mine');

  assert.deepEqual(setProfileTick(home, '.claude-later', true), {
    conflicts: [], removed: { links: [], checklists: false },
  });
  assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');
  assert.deepEqual(entries(home, '.claude-later'), ownLinks);

  assert.deepEqual(setProfileTick(home, '.claude-later', false), { conflicts: [], removed: { links: ['lar-work', 'tdd'], checklists: false } });
  assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');

  setProfileTick(home, '.claude', false);

  assert.deepEqual(entries(home, '.claude'), { tdd: 'folder' });
});

test('a link to the right skill folder the engine did not make is a Clash whenever a profile is linked', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  // A profile made after the first install.
  mkdirSync(join(home, '.claude-later/skills'), { recursive: true });
  symlinkSync(join(home, '.agents/skills/tdd'), join(home, '.claude-later/skills/tdd'));

  assert.deepEqual(setProfileTick(home, '.claude-later', true).conflicts, [join(home, '.claude-later/skills/tdd')]);

  symlinkSync(join(home, '.agents/skills/grill'), join(home, '.claude/skills/grill'));
  assert.deepEqual(installSkills(home, bundle({ ...linked, 'skills/grill/SKILL.md': 'grill' }), '2.0.0').conflicts, [join(home, '.claude/skills/grill'), join(home, '.claude-later/skills/tdd')]);
  assert.deepEqual(manifest(home).targets['.claude/skills']!.skills, ['lar-work', 'tdd']);
});
test('manifest profiles and links that are not one profile folder name are ignored', () => {
  const root = temporary();
  const home = join(root, 'home');
  mkdirSync(join(root, 'outside'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(root, 'outside-link'));
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  const state = { ticked: true, links: ['../../../outside-link'], references: true };
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'], profiles: { '.claude': state, '../outside': state, '.': state, other: state },
  }));

  installSkills(home, bundle(linked), '2.0.0');
  setProfileTick(home, '.claude', false);

  assert.deepEqual(readdirSync(join(root, 'outside')), []);
  assert.ok(lstatSync(join(root, 'outside-link')).isSymbolicLink());
  assert.deepEqual(Object.keys(manifest(home).targets), ['.agents/skills', '.claude/skills']);
});

test('manifest profile entries that are not an object are dropped and wrong field types read as unset', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-work');
  installSkills(home, bundle(linked), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'],
    profiles: { '.claude': null, '.claude-work': { ticked: 'yes', links: 3, references: 1 }, '.claude-x': 'on', '.claude-y': [] },
  }));

  installSkills(home, bundle(linked), '2.0.0');

  assert.deepEqual(manifest(home).targets, {
    '.agents/skills': finished('agents', '2.0.0', ['lar-work', 'tdd']),
    '.claude-work/skills': finished('claude', '1.0.0', [], { selection: 'unticked' }),
    // Without an entry, ~/.claude is a default target again, and the links it made before are Clashes.
    '.claude/skills': finished('claude', '2.0.0', []),
  });
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: false }]);
});

test('an upgrade links new skills and removes the links of a dropped skill from every profile', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-work');
  installSkills(home, bundle(linked), '1.0.0');
  setProfileTick(home, '.claude-work', true);
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;

  installSkills(home, bundle({ ...withoutTdd, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  for (const name of ['.claude', '.claude-work']) {
    assert.deepEqual(entries(home, name), { 'lar-work': ownLinks['lar-work'], grill: '../../.agents/skills/grill' });
    assert.deepEqual(manifest(home).targets[`${name}/skills`]!.skills, ['grill', 'lar-work']);
  }
  assertChecklistsResolve(home, '.claude');
  assert.equal(readFileSync(join(home, '.claude/skills/lar-work/references/review.md'), 'utf8'), 'review v1');
});

test('an upgrade that drops a skill leaves a folder put in place of its profile link', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  rmSync(join(home, '.claude/skills/tdd'));
  mkdirSync(join(home, '.claude/skills/tdd'));
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;

  installSkills(home, bundle(withoutTdd), '2.0.0');

  assert.deepEqual(entries(home, '.claude'), { 'lar-work': ownLinks['lar-work'], tdd: 'folder' });
});
test('ticking a folder that is not a Claude profile throws', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');

  assert.throws(() => setProfileTick(home, '.claude-missing', true), /\.claude-missing/);
  assert.throws(() => setProfileTick(home, '../.claude', true), /\.\.\/\.claude/);
});

test('the same version reports a ticked profile missing or wrong link as Drift, Replace puts it back, and an unticked profile stays', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-off');
  const source = bundle(linked);
  installSkills(home, source, '1.0.0');
  setProfileTick(home, '.claude-off', true);
  setProfileTick(home, '.claude-off', false);
  rmSync(join(home, '.claude/skills/lar-work'));
  rmSync(join(home, '.claude/skills/tdd'));
  symlinkSync('../../elsewhere/tdd', join(home, '.claude/skills/tdd'));
  symlinkSync('../../elsewhere/tdd', join(home, '.claude-off/skills/tdd'));

  const checked = writesDuring(() => installSkills(home, source, '1.0.0', { now }));

  assert.deepEqual(checked.writes, []);
  assert.deepEqual(checked.result.drift, ['lar-work', 'tdd'].map((skill) => ({ skill, paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills', skill) }] })));
  assert.deepEqual(entries(home, '.claude'), { tdd: '../../elsewhere/tdd' });

  const result = installSkills(home, source, '1.0.0', { now, replace: true });

  assert.deepEqual([result.installed, result.conflicts, result.replaced], [true, [], ['lar-work', 'tdd']]);
  assert.deepEqual(manifest(home).status, replacedStatus('lar-work', 'tdd'));
  assert.deepEqual(entries(home, '.claude'), ownLinks);
  assert.deepEqual(entries(home, '.claude-off'), { tdd: '../../elsewhere/tdd' });
});
test('a folder that replaced an engine link stays and becomes a conflict', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  rmSync(join(home, '.claude/skills/tdd'));
  mkdirSync(join(home, '.claude/skills/tdd'));

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.conflicts, [join(home, '.claude/skills/tdd')]);
  assert.deepEqual(entries(home, '.claude'), { 'lar-work': ownLinks['lar-work'], tdd: 'folder' });
  assert.deepEqual(manifest(home).targets['.claude/skills']!.skills, ['lar-work']);
});

test('a skill installed once the folder that blocked it moves away is matching, not restored', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'grill', 'grill from the skills CLI');
  const withGrill = bundle({ ...v1, 'skills/grill/SKILL.md': 'grill v1' });
  installSkills(home, withGrill, '2.0.0');
  rmSync(join(home, '.agents/skills/grill'), { recursive: true });

  const result = installSkills(home, withGrill, '2.0.0', { now });

  assert.deepEqual(result.skills, ['grill', 'lar-work', 'tdd']);
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill v1');
  assert.deepEqual(manifest(home).status, matching('grill', 'lar-work', 'tdd'));
});

test('conflicts warn on the first install of each version only, and stay blocked in the manifest', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'grill', 'grill from the skills CLI');
  const withGrill = { ...v1, 'skills/grill/SKILL.md': 'grill v1' };

  assert.equal(installSkills(home, bundle(withGrill), '2.0.0').warn, true);
  const again = installSkills(home, bundle(withGrill), '2.0.0');
  assert.deepEqual([again.warn, again.installed, again.conflicts], [false, false, [join(home, '.agents/skills/grill')]]);
  assert.equal(installSkills(home, bundle(withGrill), '3.0.0').warn, true);

  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill from the skills CLI');
  assert.deepEqual(manifest(home).status, {
    grill: { state: 'blocked', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }, ...matching('lar-work', 'tdd'),
  });
});

test('an install that does not record its warning leaves it for the next install of the version', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'grill', 'grill from the skills CLI');
  const withGrill = bundle({ ...v1, 'skills/grill/SKILL.md': 'grill v1' });

  assert.equal(installSkills(home, withGrill, '2.0.0', { recordWarning: false }).warn, true);
  assert.equal(manifest(home).warned, undefined);
  assert.equal(installSkills(home, withGrill, '2.0.0').warn, true);
  assert.equal(installSkills(home, withGrill, '2.0.0', { recordWarning: false }).warn, false);
});

test('manifest statuses of the wrong shape are dropped', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'], warned: 3,
    status: {
      'lar-work': { state: 'restored' }, tdd: { state: 'restored', restoredAt: 'then' }, '../x': { state: 'matching' },
      grill: { state: 'blocked' }, other: { state: 'blocked', paths: [3] }, older: { state: 'blocked', paths: ['/home/.agents/skills/older'] },
      odd: { state: 'blocked', paths: [{ place: 'profile', path: '/home/.claude/skills/odd' }] },
    },
  }));

  installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(manifest(home), {
    version: '1.0.0', status: { 'lar-work': { state: 'matching' }, tdd: { state: 'restored', restoredAt: 'then' } },
    targets: { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) },
  });
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

  assert.deepEqual({ ...result, targets: [] }, { installed: true, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false, targets: [] });
  assert.deepEqual(result.targets.map(({ path, active, finished }) => [relative(home, path), active, finished]), [
    ['.agents/skills', true, true], ['.claude/skills', false, false], ...antigravity.map((folder) => [folder, true, true]),
  ]);
  for (const folder of antigravity) {
    assert.ok(!lstatSync(join(home, folder, 'tdd')).isSymbolicLink(), `${folder}/tdd is a copy`);
    assert.equal(readFileSync(join(home, folder, 'lar-work/scripts/status.sh'), 'utf8'), 'status v1');
    assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work', 'tdd']);
  }
  assert.deepEqual(antigravityOwned(home), [['lar-work', 'tdd'], ['lar-work', 'tdd']]);
  assert.equal(installSkills(home, bundle(v1), '1.0.0').installed, false);
});

test('without ~/.gemini an install creates nothing for Antigravity', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');

  assert.ok(!existsSync(join(home, '.gemini')));
  assert.deepEqual(Object.keys(manifest(home).targets), ['.agents/skills']);
});

const antigravityRestores = {
  'an edited file': (path: string) => writeFileSync(join(path, 'SKILL.md'), 'edited'),
  'a deleted file': (path: string) => rmSync(join(path, 'SKILL.md')),
  'an added file': (path: string) => writeFileSync(join(path, 'extra.md'), 'extra'),
  'a deleted folder': (path: string) => rmSync(path, { recursive: true }),
};

for (const [change, make] of Object.entries(antigravityRestores)) {
  for (const folder of antigravity) {
    test(`the same version reports ${folder}/tdd with ${change} as Drift, and Replace overwrites it`, () => {
      const home = geminiHome();
      const source = bundle(v1);
      installSkills(home, source, '1.0.0');
      make(join(home, folder, 'tdd'));

      const checked = writesDuring(() => installSkills(home, source, '1.0.0', { now }));

      assert.deepEqual(checked.writes, []);
      assert.deepEqual(checked.result.drift, [{ skill: 'tdd', paths: [{ place: 'antigravity', path: join(home, folder, 'tdd') }] }]);

      const result = installSkills(home, source, '1.0.0', { now, replace: true });

      assert.deepEqual([result.installed, result.replaced], [true, ['tdd']]);
      assert.deepEqual(readdirSync(join(home, folder, 'tdd')), ['SKILL.md']);
      assert.equal(readFileSync(join(home, folder, 'tdd/SKILL.md'), 'utf8'), 'tdd v1');
      assert.deepEqual(manifest(home).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
    });
  }
}

test('a folder in an Antigravity skills folder the engine did not make stays and is a conflict', () => {
  const home = geminiHome();
  const app = join(home, '.gemini/config/skills');
  mkdirSync(join(app, 'tdd'), { recursive: true });
  writeFileSync(join(app, 'tdd/SKILL.md'), 'tdd from the skills CLI');

  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result.conflicts, [join(app, 'tdd')]);
  assert.deepEqual(result.blocked, [{ skill: 'tdd', paths: [{ place: 'antigravity', path: join(app, 'tdd') }] }]);
  assert.equal(result.warn, true);
  assert.deepEqual(manifest(home).status, {
    'lar-work': { state: 'matching' }, tdd: { state: 'blocked', paths: [{ place: 'antigravity', path: join(app, 'tdd') }] },
  });
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd from the skills CLI');
  assert.equal(readFileSync(join(home, '.gemini/antigravity-cli/skills/tdd/SKILL.md'), 'utf8'), 'tdd v1');
  assert.deepEqual(antigravityOwned(home), [['lar-work'], ['lar-work', 'tdd']]);

  installSkills(home, bundle(v2), '2.0.0');
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd from the skills CLI');
});

test('a link in an Antigravity skills folder is a conflict, even one to the installed skill', () => {
  const home = geminiHome();
  const app = join(home, '.gemini/config/skills');
  mkdirSync(join(home, '.agents/skills'), { recursive: true });
  mkdirSync(app, { recursive: true });
  symlinkSync(join(home, '.agents/skills/tdd'), join(app, 'tdd'));

  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result.conflicts, [join(app, 'tdd')]);
  assert.equal(readlinkSync(join(app, 'tdd')), join(home, '.agents/skills/tdd'));
});

test('a first install leaves a copy in an Antigravity skills folder that matches the bundle as a Clash', () => {
  const home = geminiHome();
  const app = join(home, '.gemini/config/skills');
  mkdirSync(join(app, 'tdd'), { recursive: true });
  writeFileSync(join(app, 'tdd/SKILL.md'), 'tdd v1');

  assert.deepEqual(installSkills(home, bundle(v1), '1.0.0').conflicts, [join(app, 'tdd')]);
  installSkills(home, bundle(v2), '2.0.0');
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd v1');
});
test('an upgrade whose bundle drops a skill removes its Antigravity copies, edited or not, and an existing install gains them', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  mkdirSync(join(home, '.gemini'));
  installSkills(home, bundle(v1), '1.0.0');
  for (const folder of antigravity) assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(manifest(home).status, matching('lar-work', 'tdd'));
  writeFileSync(join(home, antigravity[0]!, 'tdd/SKILL.md'), 'edited');

  const { 'skills/tdd/SKILL.md': _, ...withoutTdd } = v2;
  installSkills(home, bundle(withoutTdd), '2.0.0');

  for (const folder of antigravity) assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work']);
  assert.deepEqual(antigravityOwned(home), [['lar-work'], ['lar-work']]);
});
test('an upgrade that drops a skill leaves a link or file put in place of its Antigravity copy', () => {
  const home = geminiHome();
  installSkills(home, bundle(v1), '1.0.0');
  const [app, cli] = antigravity.map((folder) => join(home, folder, 'tdd'));
  rmSync(app!, { recursive: true });
  symlinkSync(join(home, 'elsewhere/tdd'), app!);
  rmSync(cli!, { recursive: true });
  writeFileSync(cli!, 'mine');

  const { 'skills/tdd/SKILL.md': _, ...withoutTdd } = v2;
  installSkills(home, bundle(withoutTdd), '2.0.0');

  assert.equal(readlinkSync(app!), join(home, 'elsewhere/tdd'));
  assert.equal(readFileSync(cli!, 'utf8'), 'mine');
});

test('legacy manifest Antigravity entries for other folders or with names that are not one folder name are dropped', () => {
  const home = geminiHome();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'],
    antigravity: { '.gemini/config/skills': ['lar-work', 'tdd', '../x'], '.gemini/other': ['tdd'], '.gemini/antigravity-cli/skills': 'tdd' },
  }));

  const result = installSkills(home, bundle(v1), '1.0.0');

  // The CLI folder's entry isn't a list, so its copies are no longer the engine's.
  assert.deepEqual(result.conflicts, ['lar-work', 'tdd'].map((name) => join(home, '.gemini/antigravity-cli/skills', name)));
  assert.deepEqual(antigravityOwned(home), [['lar-work', 'tdd'], []]);
  assert.deepEqual(Object.keys(manifest(home).targets), ['.agents/skills', ...antigravity].sort());
});

test('manifest targets at a relative path, of an unknown kind or not an object are dropped, and wrong field types read as unset', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  const agents = join(home, '.agents/skills');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0',
    targets: {
      [agents]: { kind: 'agents', release: 1, finished: 'yes', skills: ['lar-work', 'tdd', '../x'], selection: 'maybe', digests: { tdd: 3 } },
      'relative/skills': { kind: 'agents', release: '1.0.0', finished: true, skills: ['tdd'] },
      [join(home, 'other')]: { kind: 'codex', release: '1.0.0', finished: true, skills: ['tdd'] },
      [join(home, 'null')]: null,
    },
  }));

  installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(manifest(home).targets, { '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']) });
});

test('a newly offered target gets the current Release without rewriting the targets already on it', () => {
  const home = temporary();
  const source = bundle(v1);
  installSkills(home, source, '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
  const before = { agents: lstatSync(join(home, '.agents/skills/lar-work')).ino, entry: manifest(home).targets['.agents/skills'] };
  mkdirSync(join(home, '.gemini'));

  const result = installSkills(home, source, '1.0.0');

  assert.deepEqual([result.installed, result.replaced], [true, []]);
  assert.deepEqual(result.drift, [{ skill: 'tdd', paths: [{ place: 'agents', path: join(home, '.agents/skills/tdd') }] }]);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'edited');
  assert.equal(lstatSync(join(home, '.agents/skills/lar-work')).ino, before.agents);
  assert.deepEqual(manifest(home).targets['.agents/skills'], before.entry);
  for (const folder of antigravity) assert.equal(readFileSync(join(home, folder, 'tdd/SKILL.md'), 'utf8'), 'tdd v1');
  assert.deepEqual(antigravityOwned(home), [['lar-work', 'tdd'], ['lar-work', 'tdd']]);
});

test('targets that resolve to one folder install once and share one result', () => {
  const home = temporary();
  profile(home, 'claude-home');
  symlinkSync(join(home, 'claude-home'), join(home, '.claude'));
  const alias = join(home, '.claude/skills');
  const real = join(home, 'claude-home/skills');

  const result = installSkills(home, bundle(v1), '1.0.0', {
    targets: [{ kind: 'agents', path: join(home, '.agents/skills') }, { kind: 'claude', path: alias }, { kind: 'claude', path: real, required: true }],
  });

  assert.deepEqual(result.targets.slice(1), [{ kind: 'claude', path: alias, paths: [alias, real], required: true, active: true, release: '1.0.0', finished: true }]);
  assert.deepEqual(entries(home, 'claude-home'), { 'lar-work': '../../.agents/skills/lar-work', tdd: '../../.agents/skills/tdd' });
  assert.deepEqual(Object.keys(manifest(home).targets), ['.agents/skills', 'claude-home/skills']);
});

test.skipIf(runsAsRoot)('a failing target leaves the others installed, stays unfinished on its Release and installs on the next call', () => {
  const home = geminiHome();
  installSkills(home, bundle(v1), '1.0.0');
  const app = join(home, antigravity[0]!);
  chmodSync(app, 0o500);

  const failed = installSkills(home, bundle(v2), '2.0.0', { now });
  chmodSync(app, 0o700);

  const byFolder = Object.fromEntries(failed.targets.map((target) => [relative(home, target.path), target]));
  assert.match(byFolder[antigravity[0]!]!.error!.message, /EACCES/);
  assert.deepEqual([byFolder[antigravity[0]!]!.release, byFolder[antigravity[0]!]!.finished], ['1.0.0', false]);
  assert.deepEqual([byFolder['.agents/skills']!.error, byFolder[antigravity[1]!]!.release], [undefined, '2.0.0']);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.equal(readFileSync(join(home, antigravity[1]!, 'tdd/SKILL.md'), 'utf8'), 'tdd v2');
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd v1');
  assert.deepEqual(manifest(home).targets[antigravity[0]!], { kind: 'antigravity', release: '1.0.0', finished: false, skills: ['lar-work', 'tdd'] });

  const retried = installSkills(home, bundle(v2), '2.0.0', { now });

  assert.deepEqual([retried.installed, retried.replaced, retried.drift], [true, [], []]);
  assert.ok(retried.targets.every((target) => !target.error));
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd v2');
  assert.deepEqual(manifest(home).targets[antigravity[0]!], finished('antigravity', '2.0.0', ['lar-work', 'tdd']));
});

test.skipIf(runsAsRoot)('a same-Release check that fails in a target already on that Release keeps it current, so the next check leaves its Drift', () => {
  const home = temporary();
  const source = bundle(v1);
  installSkills(home, source, '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');
  const unreadable = join(home, '.agents/skills/tdd/notes.md');
  writeFileSync(unreadable, 'notes');
  chmodSync(unreadable, 0o000);

  const failed = installSkills(home, source, '1.0.0');
  chmodSync(unreadable, 0o644);

  assert.match(agentsError(failed)!.message, /EACCES/);
  assert.deepEqual(manifest(home).targets['.agents/skills'], finished('agents', '1.0.0', ['lar-work', 'tdd']));

  const next = installSkills(home, source, '1.0.0');

  assert.deepEqual([agentsError(next), next.replaced, next.drift.map(({ skill }) => skill)], [undefined, [], ['tdd']]);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'edited');
});

test('a target whose swap failed partway owns what it wrote, so the retry reports no Drift', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  const target = join(home, '.agents/skills/tdd');
  const rename = fs.renameSync;
  const mocked = vi.spyOn(fs, 'renameSync').mockImplementation((from: fs.PathLike, to: fs.PathLike) => {
    if (to === target && !String(from).endsWith('.previous')) throw Object.assign(new Error('EIO: move failed'), { code: 'EIO' });
    rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    assert.equal(agentsError(installSkills(home, bundle(v2), '2.0.0'))?.changed, true);
  } finally {
    mocked.mockRestore();
    syncBuiltinESMExports();
  }
  assert.equal(read(home, 'skills/lar-work/SKILL.md'), 'lar-work v2');

  const retried = installSkills(home, bundle(v2), '2.0.0');

  assert.deepEqual([agentsError(retried), retried.replaced], [undefined, []]);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
});

test('an unticked target gets no writes, and its Clash neither shows nor blocks a skill', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  setProfileTick(home, '.claude', false);
  mkdirSync(join(home, '.claude/skills/tdd'), { recursive: true });
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;

  const result = installSkills(home, bundle({ ...withoutTdd, 'skills/tdd/SKILL.md': 'tdd v2' }), '2.0.0');

  assert.deepEqual([result.conflicts, result.blocked], [[], []]);
  assert.deepEqual(result.targets[1], {
    kind: 'claude', path: join(home, '.claude/skills'), paths: [join(home, '.claude/skills')], required: false, selection: 'unticked', active: false,
    release: '1.0.0', finished: true,
  });
  assert.deepEqual(entries(home, '.claude'), { tdd: 'folder' });
  assert.deepEqual(manifest(home).targets['.claude/skills'], finished('claude', '1.0.0', [], { selection: 'unticked' }));
});

test('a target T3 requires installs even when the migrated manifest says the User unticked it', () => {
  const home = temporary();
  profile(home, '.claude-work');
  writeFileSync(join(home, '.claude-work/README.md'), 'mine');
  mkdirSync(join(home, '.agents'));
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '1.0.0', skills: [], profiles: { '.claude-work': { ticked: false, links: [] } } }));
  const path = join(home, '.claude-work/skills');

  const result = installSkills(home, bundle(linked), '1.0.0', { targets: [...defaultTargets(home), { kind: 'claude', path, required: true }] });

  assert.deepEqual(result.targets.at(-1), { kind: 'claude', path, paths: [path], required: true, selection: 'unticked', active: true, release: '1.0.0', finished: true });
  assert.deepEqual(entries(home, '.claude-work'), ownLinks);
  assertChecklistsResolve(home, '.claude-work');
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
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'], digests: recorded, status: matching('lar-work', 'tdd'), warned: '0.9.0',
    profiles: {
      '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: false },
      '.claude-work': { ticked: true, links: ['lar-work', 'tdd'], references: true },
      '.claude-off': { ticked: false, links: [], references: false },
    },
    antigravity: Object.fromEntries(antigravity.map((folder) => [folder, ['lar-work', 'tdd']])),
  }));

  assert.deepEqual(listClaudeProfiles(home), ['.claude', '.claude-off', '.claude-work'].map((name) => ({ name, ticked: name !== '.claude-off' })));
  const same = installSkills(home, source, '1.0.0');

  assert.deepEqual([same.drift.map(({ skill }) => skill), same.conflicts], [['tdd'], []]);
  assert.deepEqual(manifest(home), {
    version: '1.0.0', status: matching('lar-work', 'tdd'), warned: '0.9.0',
    targets: {
      '.agents/skills': finished('agents', '1.0.0', ['lar-work', 'tdd']),
      '.claude-off/skills': finished('claude', '1.0.0', [], { selection: 'unticked' }),
      '.claude-work/skills': finished('claude', '1.0.0', ['lar-work', 'tdd'], { selection: 'ticked', references: true }),
      '.claude/skills': finished('claude', '1.0.0', ['lar-work', 'tdd'], { selection: 'ticked' }),
      ...Object.fromEntries(antigravity.map((folder) => [folder, finished('antigravity', '1.0.0', ['lar-work', 'tdd'])])),
    },
  });
  assert.deepEqual(digests(home), recorded);

  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;
  const upgrade = installSkills(home, bundle(withoutTdd), '2.0.0', { now });

  assert.deepEqual(upgrade.replaced, []);
  assert.deepEqual(readdirSync(join(home, '.agents/skills')), ['lar-work']);
  for (const name of ['.claude', '.claude-work']) assert.deepEqual(entries(home, name), { 'lar-work': ownLinks['lar-work'] });
  for (const folder of antigravity) assert.deepEqual(readdirSync(join(home, folder)), ['lar-work']);
  assert.ok(!existsSync(join(home, '.claude-off/skills')));
  setProfileTick(home, '.claude-work', false);
  assert.ok(!existsSync(join(home, '.claude-work/references')));
});

/** Every path in `folder` with its content or link target, without following links. */
function tree(folder: string, prefix = ''): string[] {
  return readdirSync(folder).sort().flatMap((entry) => {
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

  const result = installSkills(root, bundle(v1), '1.0.0', { root, targets: [...defaultTargets(root), { kind: 'claude', path: join(outside.home, 'skills'), required: true }] });

  assert.deepEqual(outside.files(), before);
  const rejected = result.targets.find(({ path }) => path === join(outside.home, 'skills'));
  assert.equal(rejected?.active, false);
  assert.match(rejected?.error?.message ?? '', /outside the install root/);
  assert.equal(rejected?.error?.changed, false);
  assert.deepEqual(result.skills, ['lar-work', 'tdd']);
  assert.deepEqual(Object.keys(manifest(root).targets), ['.agents/skills']);
});

test('with a root, a Claude home linked from inside it to outside it is left alone', () => {
  const root = temporary();
  const outside = outsideHome();
  symlinkSync(outside.home, join(root, '.claude'));
  const before = outside.files();

  const result = installSkills(root, bundle(v1), '1.0.0', { root });

  assert.deepEqual(outside.files(), before);
  const claude = result.targets.find(({ kind }) => kind === 'claude');
  assert.equal(claude?.active, false);
  assert.match(claude?.error?.message ?? '', /outside the install root/);
  assert.throws(() => setProfileTick(root, '.claude', true, { root }), /outside the install root/);
  assert.deepEqual(outside.files(), before);
});

test('with a root, a migrated target outside it is neither written nor removed', () => {
  const root = temporary();
  const outside = outsideHome();
  for (const skill of ['lar-work', 'tdd']) symlinkSync(join(root, '.agents/skills', skill), join(outside.home, 'skills', skill));
  symlinkSync(outside.home, join(root, '.claude-work'));
  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(join(root, '.agents', INSTALL_MANIFEST), JSON.stringify({
    version: '1.0.0', skills: ['lar-work', 'tdd'], profiles: { '.claude-work': { ticked: true, links: ['lar-work', 'tdd'] } },
  }));
  const before = outside.files();

  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = v2;
  const result = installSkills(root, bundle(withoutTdd), '2.0.0', { root });

  assert.deepEqual(outside.files(), before);
  assert.match(result.targets.find(({ path }) => path === join(outside.home, 'skills'))?.error?.message ?? '', /outside the install root/);
  assert.deepEqual(manifest(root).targets[relative(root, join(outside.home, 'skills'))]?.skills, ['lar-work', 'tdd']);
  assert.throws(() => setProfileTick(root, '.claude-work', false, { root }), /outside the install root/);
  assert.deepEqual(outside.files(), before);
});

test('with a root, an ~/.agents linked to outside it stops the install before any write', () => {
  const root = temporary();
  const outside = temporary();
  symlinkSync(outside, join(root, '.agents'));

  assert.throws(() => installSkills(root, bundle(v1), '1.0.0', { root }), (error: unknown) =>
    error instanceof Error && /outside the install root/.test(error.message) && (error as { changed?: boolean }).changed === false);
  assert.deepEqual(readdirSync(outside), []);
});

test('without a root, an offered target at an absolute home elsewhere installs as before', () => {
  const home = temporary();
  const other = outsideHome();

  const result = installSkills(home, bundle(v1), '1.0.0', { targets: [...defaultTargets(home), { kind: 'claude', path: join(other.home, 'skills'), required: true }] });

  assert.equal(result.targets.find(({ path }) => path === join(other.home, 'skills'))?.error, undefined);
  assert.ok(lstatSync(join(other.home, 'skills/tdd')).isSymbolicLink());
});
