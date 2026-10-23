import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTALL_MANIFEST, installSkills } from '../src/install-skills.ts';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'install-skills-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** Writes each `relative path: content` pair under a new bundle folder. */
function bundle(t: TestContext, files: Record<string, string>): string {
  const root = temporary(t);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const v1 = {
  'skills/mux-work/SKILL.md': 'mux-work v1',
  'skills/mux-work/scripts/status.sh': 'status v1',
  'skills/tdd/SKILL.md': 'tdd v1',
  'references/pr-checklist.md': 'pr v1',
  'references/review.md': 'review v1',
};

const v2 = {
  'skills/mux-work/SKILL.md': 'mux-work v2',
  'skills/mux-work/scripts/status.sh': 'status v2',
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

test('a fresh install copies every skill and checklist and writes the manifest', (t) => {
  const home = temporary(t);
  const result = installSkills(home, bundle(t, v1), '1.0.0');

  assert.deepEqual(result, { installed: true, version: '1.0.0', skills: ['mux-work', 'tdd'] });
  for (const [path, content] of Object.entries(v1)) {
    assert.equal(readFileSync(join(home, '.agents', path), 'utf8'), content);
    assert.ok(lstatSync(join(home, '.agents', path)).isFile(), `${path} is a real file`);
  }
  assert.ok(!lstatSync(join(home, '.agents/skills/tdd')).isSymbolicLink());
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['mux-work', 'tdd'] });
  assert.ok(!existsSync(join(home, '.agents/.skill-lock.json')));
});

test('the same version again changes nothing', (t) => {
  const home = temporary(t);
  installSkills(home, bundle(t, v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');

  const result = installSkills(home, bundle(t, v2), '1.0.0');

  assert.deepEqual(result, { installed: false, version: '1.0.0', skills: ['mux-work', 'tdd'] });
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'edited');
  assert.equal(read(home, 'references/review.md'), 'review v1');
});

test('a new version replaces the copies and leaves no temporary folders', (t) => {
  const home = temporary(t);
  installSkills(home, bundle(t, v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/stale.md'), 'stale');
  writeFileSync(join(home, '.agents/references/stale.md'), 'stale');

  const result = installSkills(home, bundle(t, v2), '1.1.0');

  assert.equal(result.installed, true);
  assert.equal(read(home, 'skills/mux-work/scripts/status.sh'), 'status v2');
  assert.equal(read(home, 'references/pr-checklist.md'), 'pr v2');
  assert.ok(!existsSync(join(home, '.agents/skills/tdd/stale.md')));
  assert.ok(!existsSync(join(home, '.agents/references/stale.md')));
  assert.deepEqual(manifest(home), { version: '1.1.0', skills: ['mux-work', 'tdd'] });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['mux-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'references', 'skills']);
});

test('force reinstalls the same version', (t) => {
  const home = temporary(t);
  installSkills(home, bundle(t, v1), '1.0.0');
  writeFileSync(join(home, '.agents/skills/tdd/SKILL.md'), 'edited');

  const result = installSkills(home, bundle(t, v1), '1.0.0', { force: true });

  assert.equal(result.installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

/** Matches the engine's InstallError whose `changed` is `changed`. */
const installError = (changed: boolean) => (error: unknown) =>
  error instanceof Error && error.name === 'InstallError' && (error as Error & { changed: boolean }).changed === changed;

test('a failed copy says nothing changed yet', (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads unreadable files');
  const broken = bundle(t, v1);
  chmodSync(join(broken, 'references/review.md'), 0o000);

  assert.throws(() => installSkills(temporary(t), broken, '1.0.0'), installError(false));
});

test('a manifest that is not valid JSON fails with its path and changes nothing', (t) => {
  const home = temporary(t);
  installSkills(home, bundle(t, v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), '{ not json');

  assert.throws(() => installSkills(home, bundle(t, v2), '2.0.0'),
    (error) => installError(false)(error) && (error as Error).message.includes(join(home, '.agents', INSTALL_MANIFEST)));
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v1');
});

test('manifest skill names that are not one folder name are ignored', (t) => {
  const home = temporary(t);
  const outside = join(home, 'outside');
  mkdirSync(outside);
  installSkills(home, bundle(t, v1), '1.0.0');
  writeFileSync(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '1.0.0', skills: ['mux-work', 'tdd', '../../outside', '..', '.', '', 'a/b', 3] }));

  installSkills(home, bundle(t, v2), '2.0.0');

  assert.ok(existsSync(outside));
  assert.ok(existsSync(join(home, '.agents/skills')));
  assert.deepEqual((manifest(home) as { skills: string[] }).skills, ['mux-work', 'tdd']);
});

test('skills and files outside the bundle are left alone', (t) => {
  const home = temporary(t);
  mkdirSync(join(home, '.agents/skills/other'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/other/SKILL.md'), 'other');
  writeFileSync(join(home, '.agents/.skill-lock.json'), '{"lock":true}');

  installSkills(home, bundle(t, v1), '1.0.0');

  assert.equal(read(home, 'skills/other/SKILL.md'), 'other');
  assert.equal(read(home, '.skill-lock.json'), '{"lock":true}');
});

test('a copy that fails partway keeps the previous version, and a later call succeeds', (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads unreadable files');
  const home = temporary(t);
  installSkills(home, bundle(t, v1), '1.0.0');
  const broken = bundle(t, v2);
  const unreadable = join(broken, 'skills/tdd/SKILL.md');
  chmodSync(unreadable, 0o000);

  assert.throws(() => installSkills(home, broken, '2.0.0'), /skill tdd/);

  for (const [path, content] of Object.entries(v1)) assert.equal(read(home, path), content);
  assert.deepEqual(manifest(home), { version: '1.0.0', skills: ['mux-work', 'tdd'] });
  assert.deepEqual(readdirSync(join(home, '.agents/skills')).sort(), ['mux-work', 'tdd']);
  assert.deepEqual(readdirSync(join(home, '.agents')).sort(), [INSTALL_MANIFEST, 'references', 'skills']);

  chmodSync(unreadable, 0o644);
  assert.equal(installSkills(home, broken, '2.0.0').installed, true);
  assert.equal(read(home, 'skills/tdd/SKILL.md'), 'tdd v2');
  assert.deepEqual(manifest(home), { version: '2.0.0', skills: ['mux-work', 'tdd'] });
});

test('a failed checklist copy names the references folder', (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads unreadable files');
  const home = temporary(t);
  const broken = bundle(t, v1);
  const unreadable = join(broken, 'references/review.md');
  chmodSync(unreadable, 0o000);

  assert.throws(() => installSkills(home, broken, '1.0.0'), /references/);
  assert.ok(!existsSync(join(home, '.agents', INSTALL_MANIFEST)));
});
