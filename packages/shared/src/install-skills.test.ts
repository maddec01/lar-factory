import { onTestFinished, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_MANIFEST, installSkills, listClaudeProfiles, readSkillStatus, setProfileTick } from './install-skills.ts';

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'install-skills-'));
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

/** The manifest without its digests, which `digests` checks. */
function manifest(home: string): unknown {
  const { digests: _, ...rest } = JSON.parse(read(home, INSTALL_MANIFEST)) as Record<string, unknown>;
  return rest;
}

function digests(home: string): Record<string, string> {
  return (JSON.parse(read(home, INSTALL_MANIFEST)) as { digests: Record<string, string> }).digests;
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

  assert.deepEqual(result, { installed: true, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false });
  for (const [path, content] of Object.entries(v1)) {
    assert.equal(readFileSync(join(home, '.agents', path), 'utf8'), content);
    assert.ok(lstatSync(join(home, '.agents', path)).isFile(), `${path} is a real file`);
  }
  assert.ok(!lstatSync(join(home, '.agents/skills/tdd')).isSymbolicLink());
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['lar-work', 'tdd'], status: matching('lar-work', 'tdd'), profiles: {} });
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
  assert.deepEqual(manifest(home), { version: '1.1.0', skills: ['lar-work', 'tdd'], status: replacedStatus('lar-work', 'tdd'), profiles: {} });
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
    assert.deepEqual((manifest(home) as { status: unknown }).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, { ...matching('lar-work'), ...replacedStatus('tdd') });

  installSkills(home, bundle(v2), '2.0.0');
  assert.deepEqual((manifest(home) as { status: unknown }).status, matching('lar-work', 'tdd'));
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
  assert.deepEqual((manifest(home) as { skills: string[] }).skills, ['lar-work', 'tdd']);
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
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['lar-work', 'tdd'], status: matching('lar-work', 'tdd'), profiles: {} });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'skills']);

  chmodSync(unreadable, 0o644);
  assert.equal(installSkills(home, broken, '2.0.0').installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['lar-work', 'tdd'], status: matching('lar-work', 'tdd'), profiles: {} });
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
      version: '1.0.0', skills: ['lar-work'], status: { ...matching('lar-work'), tdd: { state: 'blocked', paths: [clash] } }, warned: '1.0.0', profiles: {},
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

  assert.deepEqual(result, { installed: true, version: '2.0.0', skills: ['lar-work'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'other']);
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['lar-work'], status: matching('lar-work'), profiles: {} });
  assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test.skipIf(runsAsRoot)('a swap that fails partway removes the staged copies left and says files changed', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  // A read-only first skill folder moves aside but can't be deleted, so its swap throws.
  const locked = join(home, '.agents/skills/lar-work');
  chmodSync(locked, 0o500);

  assert.throws(() => installSkills(home, bundle(v2), '2.0.0'), installError(true));
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
      assert.throws(() => installSkills(home, bundle(v2), '2.0.0'), installError(changed));
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
    assert.throws(() => installSkills(home, bundle(v2), '2.0.0'), installError(false));
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

  assert.deepEqual(result, {
    installed: true, version: '2.0.0', skills: ['lar-work', 'tdd'], conflicts: [join(home, '.agents/skills/grill')],
    blocked: [{ skill: 'grill', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }], drift: [], replaced: [], warn: true,
  });
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill from the skills CLI');
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), {
    version: '2.0.0', skills: ['lar-work', 'tdd'], status: { grill: { state: 'blocked', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }, ...matching('lar-work', 'tdd') },
    warned: '2.0.0', profiles: {},
  });
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test('a bundled skill new to an upgrade installs when nothing holds its name', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');

  const result = installSkills(home, bundle({ ...v2, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  assert.deepEqual(result.conflicts, []);
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['grill', 'lar-work', 'tdd'], status: matching('grill', 'lar-work', 'tdd'), profiles: {} });
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

const ownLinks = { 'lar-work': '../../.agents/skills/lar-work', tdd: '../../.agents/skills/tdd' };

test('a fresh install links every skill and copies the checklists into each Claude profile', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-work');
  profile(home, '.claudex');
  writeFileSync(join(home, '.claude-notes'), 'not a profile');

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.conflicts, []);
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
    skills: ['lar-work', 'tdd'],
    status: matching('lar-work', 'tdd'),
    profiles: {
      '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: false },
      '.claude-work': { ticked: true, links: ['lar-work', 'tdd'], references: false },
    },
  });
});

test('unticking a profile removes only the engine links and checklists, and ticking restores them', () => {
  const home = temporary();
  profile(home, '.claude-work');
  installSkills(home, bundle(linked), '1.0.0');
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
  assert.deepEqual((manifest(home) as { profiles: unknown }).profiles, {
    '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: false },
    '.claude-later': { ticked: false, links: [], references: false },
  });

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

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.conflicts, [join(home, '.claude/skills/tdd'), join(home, '.claude-work/skills/lar-work')]);
  assert.deepEqual(result.blocked, [
    { skill: 'lar-work', paths: [{ place: 'profile', profile: '.claude-work', path: join(home, '.claude-work/skills/lar-work') }] }, { skill: 'tdd', paths: [{ place: 'profile', profile: '.claude', path: join(home, '.claude/skills/tdd') }] },
  ]);
  assert.deepEqual((manifest(home) as { status: unknown }).status, {
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
  assert.deepEqual((manifest(home) as { profiles: Record<string, { links: string[] }> }).profiles['.claude']!.links, ['lar-work', 'tdd']);
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
  assert.deepEqual(Object.keys((manifest(home) as { profiles: object }).profiles), ['.claude']);
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

  assert.deepEqual((manifest(home) as { profiles: object }).profiles, {
    '.claude': { ticked: false, links: [], references: false },
    '.claude-work': { ticked: false, links: [], references: false },
  });
  assert.deepEqual(listClaudeProfiles(home), [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }]);
});

test('an upgrade links new skills and removes the links of a dropped skill from every profile', () => {
  const home = temporary();
  profile(home, '.claude');
  profile(home, '.claude-work');
  installSkills(home, bundle(linked), '1.0.0');
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;

  installSkills(home, bundle({ ...withoutTdd, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  for (const name of ['.claude', '.claude-work']) {
    assert.deepEqual(entries(home, name), { 'lar-work': ownLinks['lar-work'], grill: '../../.agents/skills/grill' });
    assert.deepEqual((manifest(home) as { profiles: Record<string, { links: string[] }> }).profiles[name]!.links, ['grill', 'lar-work']);
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, replacedStatus('lar-work', 'tdd'));
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
  assert.deepEqual((manifest(home) as { profiles: Record<string, { links: string[] }> }).profiles['.claude']!.links, ['lar-work']);
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, matching('grill', 'lar-work', 'tdd'));
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, {
    grill: { state: 'blocked', paths: [{ place: 'agents', path: join(home, '.agents/skills/grill') }] }, ...matching('lar-work', 'tdd'),
  });
});

test('an install that does not record its warning leaves it for the next install of the version', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeSkill(home, 'grill', 'grill from the skills CLI');
  const withGrill = bundle({ ...v1, 'skills/grill/SKILL.md': 'grill v1' });

  assert.equal(installSkills(home, withGrill, '2.0.0', { recordWarning: false }).warn, true);
  assert.equal((manifest(home) as { warned?: string }).warned, undefined);
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
    version: '1.0.0', skills: ['lar-work', 'tdd'], status: { 'lar-work': { state: 'matching' }, tdd: { state: 'restored', restoredAt: 'then' } }, profiles: {},
  });
});

/** Antigravity's skill folders in a home: the app's and the CLI's. */
const antigravity = ['.gemini/config/skills', '.gemini/antigravity-cli/skills'];

function geminiHome(): string {
  const home = temporary();
  mkdirSync(join(home, '.gemini'));
  return home;
}

test('an install copies every skill into both Antigravity folders when ~/.gemini exists', () => {
  const home = geminiHome();
  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result, { installed: true, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [], blocked: [], drift: [], replaced: [], warn: false });
  for (const folder of antigravity) {
    assert.ok(!lstatSync(join(home, folder, 'tdd')).isSymbolicLink(), `${folder}/tdd is a copy`);
    assert.equal(readFileSync(join(home, folder, 'lar-work/scripts/status.sh'), 'utf8'), 'status v1');
    assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work', 'tdd']);
  }
  assert.deepEqual((manifest(home) as { antigravity: unknown }).antigravity, {
    '.gemini/config/skills': ['lar-work', 'tdd'], '.gemini/antigravity-cli/skills': ['lar-work', 'tdd'],
  });
  assert.equal(installSkills(home, bundle(v1), '1.0.0').installed, false);
});

test('without ~/.gemini an install creates nothing for Antigravity', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');

  assert.ok(!existsSync(join(home, '.gemini')));
  assert.equal((manifest(home) as { antigravity?: unknown }).antigravity, undefined);
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
      assert.deepEqual((manifest(home) as { status: unknown }).status, { ...matching('lar-work'), ...replacedStatus('tdd') });
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
  assert.deepEqual((manifest(home) as { status: unknown }).status, {
    'lar-work': { state: 'matching' }, tdd: { state: 'blocked', paths: [{ place: 'antigravity', path: join(app, 'tdd') }] },
  });
  assert.equal(readFileSync(join(app, 'tdd/SKILL.md'), 'utf8'), 'tdd from the skills CLI');
  assert.equal(readFileSync(join(home, '.gemini/antigravity-cli/skills/tdd/SKILL.md'), 'utf8'), 'tdd v1');
  assert.deepEqual((manifest(home) as { antigravity: unknown }).antigravity, {
    '.gemini/config/skills': ['lar-work'], '.gemini/antigravity-cli/skills': ['lar-work', 'tdd'],
  });

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
  assert.deepEqual((manifest(home) as { status: unknown }).status, matching('lar-work', 'tdd'));
  writeFileSync(join(home, antigravity[0]!, 'tdd/SKILL.md'), 'edited');

  const { 'skills/tdd/SKILL.md': _, ...withoutTdd } = v2;
  installSkills(home, bundle(withoutTdd), '2.0.0');

  for (const folder of antigravity) assert.deepEqual(readdirSync(join(home, folder)).sort(), ['lar-work']);
  assert.deepEqual((manifest(home) as { antigravity: unknown }).antigravity, {
    '.gemini/config/skills': ['lar-work'], '.gemini/antigravity-cli/skills': ['lar-work'],
  });
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

test('manifest Antigravity entries for other folders or with names that are not one folder name are dropped', () => {
  const home = geminiHome();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({
    ...(manifest(home) as object),
    antigravity: { '.gemini/config/skills': ['lar-work', 'tdd', '../x'], '.gemini/other': ['tdd'], '.gemini/antigravity-cli/skills': 'tdd' },
  }));

  const result = installSkills(home, bundle(v1), '1.0.0');

  // The CLI folder's entry isn't a list, so its copies are no longer the engine's.
  assert.deepEqual(result.conflicts, ['lar-work', 'tdd'].map((name) => join(home, '.gemini/antigravity-cli/skills', name)));
  assert.deepEqual((manifest(home) as { antigravity: unknown }).antigravity, {
    '.gemini/config/skills': ['lar-work', 'tdd'], '.gemini/antigravity-cli/skills': [],
  });
});
