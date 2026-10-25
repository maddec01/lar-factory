import { onTestFinished, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_MANIFEST, installSkills, listClaudeProfiles, setProfileTick } from './install-skills.ts';

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
  'references/pr-checklist.md': 'pr v1',
  'references/review.md': 'review v1',
};

const v2 = {
  'skills/lar-work/SKILL.md': 'lar-work v2',
  'skills/lar-work/scripts/status.sh': 'status v2',
  'skills/tdd/SKILL.md': 'tdd v2',
  'references/pr-checklist.md': 'pr v2',
  'references/review.md': 'review v2',
};

function read(home: string, path: string): string {
  return readFileSync(join(home, '.agents', path), 'utf8');
}

function manifest(home: string): unknown {
  return JSON.parse(read(home, INSTALL_MANIFEST));
}

test('a fresh install copies every skill and checklist and writes the manifest', () => {
  const home = temporary();
  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result, { installed: true, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [] });
  for (const [path, content] of Object.entries(v1)) {
    assert.equal(readFileSync(join(home, '.agents', path), 'utf8'), content);
    assert.ok(lstatSync(join(home, '.agents', path)).isFile(), `${path} is a real file`);
  }
  assert.ok(!lstatSync(join(home, '.agents/skills/tdd')).isSymbolicLink());
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['lar-work', 'tdd'], profiles: {} });
  assert.ok(!existsSync(join(home, '.agents/.skill-lock.json')));
});

test('the same version again changes nothing', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');

  const result = installSkills(home, bundle(v2), '1.0.0');

  assert.deepEqual(result, { installed: false, version: '1.0.0', skills: ['lar-work', 'tdd'], conflicts: [] });
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'edited');
  assert.equal(read(home, 'references/review.md'), 'review v1');
});

test('a new version replaces the copies and leaves no temporary folders', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/stale.md'), 'stale');
  writeFileSync(join(home, '.agents/references/stale.md'), 'stale');

  const result = installSkills(home, bundle(v2), '1.1.0');

  assert.equal(result.installed, true);
  assert.equal(read(home, 'skills/lar-work/scripts/status.sh'), 'status v2');
  assert.equal(read(home, 'references/pr-checklist.md'), 'pr v2');
  assert.ok(!existsSync(join(home, '.agents/skills/tdd/stale.md')));
  assert.ok(!existsSync(join(home, '.agents/references/stale.md')));
  assert.deepEqual(manifest(home), { version: '1.1.0', skills: ['lar-work', 'tdd'], profiles: {} });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'references', 'skills']);
});

test('force reinstalls the same version', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');

  const result = installSkills(home, bundle(v1), '1.0.0', { force: true });

  assert.equal(result.installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

/** Root reads unreadable files and deletes from read-only folders, so the tests that rely on either can't run as root. */
const runsAsRoot = process.getuid?.() === 0;

/** Matches the engine's InstallError whose `changed` is `changed`. */
const installError = (changed: boolean) => (error: unknown) =>
  error instanceof Error && error.name === 'InstallError' && (error as Error & { changed: boolean }).changed === changed;

test.skipIf(runsAsRoot)('a failed copy says nothing changed yet', () => {
  const broken = bundle(v1);
  chmodSync(join(broken, 'references/review.md'), 0o000);

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
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['lar-work', 'tdd'], profiles: {} });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'references', 'skills']);

  chmodSync(unreadable, 0o644);
  assert.equal(installSkills(home, broken, '2.0.0').installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['lar-work', 'tdd'], profiles: {} });
});

test.skipIf(runsAsRoot)('a failed checklist copy names the references folder', () => {
  const home = temporary();
  const broken = bundle(v1);
  const unreadable = join(broken, 'references/review.md');
  chmodSync(unreadable, 0o000);

  assert.throws(() => installSkills(home, broken, '1.0.0'), /references/);
  assert.ok(!existsSync(join(home, '.agents', INSTALL_MANIFEST)));
});

function writeSkill(home: string, name: string, content: string): void {
  mkdirSync(join(home, '.agents/skills', name), { recursive: true });
  writeFileSync(join(home, '.agents/skills', name, 'SKILL.md'), content);
}

const lock = '{\n  "version": 3,\n  "skills": { "other": {} }\n}\n';

test('a first install adopts earlier copies of bundled skills and leaves other skills alone', () => {
  const home = temporary();
  writeSkill(home, 'tdd', 'tdd from the skills CLI');
  writeFileSync(join(home, '.agents/skills/tdd/extra.md'), 'extra');
  writeSkill(home, 'other', 'other');
  writeFileSync(join(home, '.agents/.skill-lock.json'), lock);

  const result = installSkills(home, bundle(v1), '1.0.0');

  assert.deepEqual(result.conflicts, []);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
  assert.ok(!existsSync(join(home, '.agents/skills/tdd/extra.md')));
  assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['lar-work', 'tdd'], profiles: {} });
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test('an upgrade whose bundle drops a skill removes its copy and manifest entry', () => {
  const home = temporary();
  writeSkill(home, 'other', 'other');
  writeFileSync(join(home, '.agents/.skill-lock.json'), lock);
  installSkills(home, bundle(v1), '1.0.0');
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = v2;

  const result = installSkills(home, bundle(withoutTdd), '2.0.0');

  assert.deepEqual(result, { installed: true, version: '2.0.0', skills: ['lar-work'], conflicts: [] });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['lar-work', 'other']);
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['lar-work'], profiles: {} });
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
    assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'references', 'skills']);
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
  installSkills(home, bundle({ 'skills/lar-work/SKILL.md': 'v3', 'references/review.md': 'v3' }), '3.0.0');

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
  });
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill from the skills CLI');
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['lar-work', 'tdd'], profiles: {} });
  assert.equal(read(home, '.skill-lock.json'), lock);
});

test('a bundled skill new to an upgrade installs when nothing holds its name', () => {
  const home = temporary();
  installSkills(home, bundle(v1), '1.0.0');

  const result = installSkills(home, bundle({ ...v2, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  assert.deepEqual(result.conflicts, []);
  assert.equal(read(home, 'skills/grill/SKILL.md'), 'grill v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['grill', 'lar-work', 'tdd'], profiles: {} });
});

/** v1 with a checklist link in one skill, as the real skills have. */
const linked = { ...v1, 'skills/lar-work/SKILL.md': 'See `../../references/review.md` and [the PR list](../../references/pr-checklist.md#top).' };

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
      for (const [, path] of text.matchAll(/(?:`|\]\()(\.\.\/[^`) ]*)/g)) {
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
    assert.equal(readFileSync(join(home, name, 'references/review.md'), 'utf8'), 'review v1');
    assert.ok(!lstatSync(join(home, name, 'references')).isSymbolicLink());
    assertChecklistsResolve(home, name);
    assert.deepEqual(readdirSync(join(home, name)).sort(), ['references', 'skills']);
  }
  assert.ok(!existsSync(join(home, '.claudex/skills')));
  assert.deepEqual(manifest(home), {
    version: '1.0.0',
    skills: ['lar-work', 'tdd'],
    profiles: {
      '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: true },
      '.claude-work': { ticked: true, links: ['lar-work', 'tdd'], references: true },
    },
  });
});

test('unticking a profile removes only the engine links and checklists, and ticking restores them', () => {
  const home = temporary();
  profile(home, '.claude-work');
  installSkills(home, bundle(linked), '1.0.0');
  mkdirSync(join(home, '.claude-work/skills/mine'));
  writeFileSync(join(home, '.claude-work/settings.json'), '{}');

  assert.deepEqual(setProfileTick(home, '.claude-work', false), { conflicts: [], removed: { links: ['lar-work', 'tdd'], checklists: true } });

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
    '.claude': { ticked: true, links: ['lar-work', 'tdd'], references: true },
    '.claude-later': { ticked: false, links: [], references: false },
  });

  setProfileTick(home, '.claude-later', true);

  assert.deepEqual(entries(home, '.claude-later'), ownLinks);
  assertChecklistsResolve(home, '.claude-later');
});

test('a first install adopts links to the right skill folder and replaces the profile references folder', () => {
  const home = temporary();
  writeSkill(home, 'tdd', 'tdd from the skills CLI');
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  symlinkSync(join(home, '.agents/skills/tdd'), join(home, '.claude/skills/tdd'));
  mkdirSync(join(home, '.claude/references'));
  writeFileSync(join(home, '.claude/references/old.md'), 'from an older install');

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(entries(home, '.claude'), { ...ownLinks, tdd: join(home, '.agents/skills/tdd') });
  assert.ok(!existsSync(join(home, '.claude/references/old.md')));
  assertChecklistsResolve(home, '.claude');

  setProfileTick(home, '.claude', false);

  assert.deepEqual(readdirSync(join(home, '.claude/skills')), []);
  assert.ok(!existsSync(join(home, '.claude/references')));
});

test('an entry the engine did not make is left in place and reported as a conflict', () => {
  const home = temporary();
  mkdirSync(join(home, '.claude/skills/tdd'), { recursive: true });
  writeFileSync(join(home, '.claude/skills/tdd/SKILL.md'), 'hand-made');
  mkdirSync(join(home, '.claude-work/skills'), { recursive: true });
  symlinkSync('../../elsewhere/lar-work', join(home, '.claude-work/skills/lar-work'));

  const result = installSkills(home, bundle(linked), '1.0.0');

  assert.deepEqual(result.conflicts, [join(home, '.claude/skills/tdd'), join(home, '.claude-work/skills/lar-work')]);
  assert.deepEqual(entries(home, '.claude'), { 'lar-work': ownLinks['lar-work'], tdd: 'folder' });
  assert.equal(readFileSync(join(home, '.claude/skills/tdd/SKILL.md'), 'utf8'), 'hand-made');
  assert.deepEqual(entries(home, '.claude-work'), { 'lar-work': '../../elsewhere/lar-work', tdd: ownLinks.tdd });

  profile(home, '.claude-later');
  mkdirSync(join(home, '.claude-later/references'));
  writeFileSync(join(home, '.claude-later/references/mine.md'), 'mine');

  assert.deepEqual(setProfileTick(home, '.claude-later', true), {
    conflicts: [join(home, '.claude-later/references')], removed: { links: [], checklists: false },
  });
  assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');
  assert.deepEqual(entries(home, '.claude-later'), ownLinks);

  assert.deepEqual(setProfileTick(home, '.claude-later', false), { conflicts: [], removed: { links: ['lar-work', 'tdd'], checklists: false } });
  assert.equal(readFileSync(join(home, '.claude-later/references/mine.md'), 'utf8'), 'mine');

  setProfileTick(home, '.claude', false);

  assert.deepEqual(entries(home, '.claude'), { tdd: 'folder' });
});

test('a link to the right skill folder is adopted whenever a profile is linked', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');
  // A profile made after the first install.
  mkdirSync(join(home, '.claude-later/skills'), { recursive: true });
  symlinkSync(join(home, '.agents/skills/tdd'), join(home, '.claude-later/skills/tdd'));

  assert.deepEqual(setProfileTick(home, '.claude-later', true).conflicts, []);
  assert.deepEqual(entries(home, '.claude-later'), { ...ownLinks, tdd: join(home, '.agents/skills/tdd') });

  symlinkSync(join(home, '.agents/skills/grill'), join(home, '.claude/skills/grill'));
  assert.deepEqual(installSkills(home, bundle({ ...linked, 'skills/grill/SKILL.md': 'grill' }), '2.0.0').conflicts, []);
  assert.deepEqual((manifest(home) as { profiles: Record<string, { links: string[] }> }).profiles['.claude']!.links, ['grill', 'lar-work', 'tdd']);

  setProfileTick(home, '.claude-later', false);
  assert.deepEqual(readdirSync(join(home, '.claude-later/skills')), []);
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
  setProfileTick(home, '.claude-work', false);
  const { 'skills/tdd/SKILL.md': _dropped, ...withoutTdd } = linked;

  installSkills(home, bundle({ ...withoutTdd, 'skills/grill/SKILL.md': 'grill v2' }), '2.0.0');

  assert.deepEqual(entries(home, '.claude'), { grill: '../../.agents/skills/grill', 'lar-work': ownLinks['lar-work'] });
  assert.deepEqual(readdirSync(join(home, '.claude-work/skills')), []);
  assertChecklistsResolve(home, '.claude');
  assert.equal(readFileSync(join(home, '.claude/references/review.md'), 'utf8'), 'review v1');
});

test('ticking a folder that is not a Claude profile throws', () => {
  const home = temporary();
  profile(home, '.claude');
  installSkills(home, bundle(linked), '1.0.0');

  assert.throws(() => setProfileTick(home, '.claude-missing', true), /\.claude-missing/);
  assert.throws(() => setProfileTick(home, '../.claude', true), /\.\.\/\.claude/);
});
