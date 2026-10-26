import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_MANIFEST } from '@lar-factory/shared/install-skills';
import { BUNDLE_URL, bundleUrl, installHome, readBundledSkills, withInstallState } from './bundled-skills.ts';

const UPSTREAM = `# Upstream

| Skill | Source | Path | Commit | Date | Overridden in |
| ----- | ------ | ---- | ------ | ---- | ------------- |
| \`tdd\` | mattpocock/skills | \`skills/engineering/tdd\` | \`5beb35b040e3\` | 2026-10-19 |  |
| \`unslop\` | cursor/plugins | \`pstack/skills/unslop\` | \`8b3326d99fd4\` | 2026-10-22 |  |
| \`references/security-checklist.md\` | addyosmani/agent-skills | \`references/security-checklist.md\` | \`aeac41d4d005\` | 2026-10-13 |  |

Full commits: mattpocock/skills \`5beb35b040e3de97e54fa9e386d7e42d15c295c2\`.

Authors: mattpocock/skills by Matt Pocock (MIT), addyosmani/agent-skills by Addy Osmani (MIT), cursor/plugins by Lauren Tan (Apache-2.0).
`;

/** A bundle with `skills` as folders, `checklists` as files in references/ and UPSTREAM.md holding `upstream`. */
async function bundleWith(t: TestContext, skills: string[], checklists: string[], upstream = UPSTREAM): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar bundled skills test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'skills'));
  for (const name of skills) await mkdir(join(dir, 'skills', name));
  await mkdir(join(dir, 'references'), { recursive: true });
  for (const name of checklists) await writeFile(join(dir, 'references', name), '');
  await writeFile(join(dir, 'UPSTREAM.md'), upstream);
  return dir;
}

test('a Copy names its source author and licence, links its path at its commit and gives its Date', async (t) => {
  const bundle = await bundleWith(t, ['tdd', 'unslop'], []);
  assert.deepEqual(readBundledSkills(bundle), [
    { name: 'tdd', author: 'Matt Pocock', licence: 'MIT', source: 'https://github.com/mattpocock/skills/tree/5beb35b040e3/skills/engineering/tdd', date: '2026-10-19' },
    { name: 'unslop', author: 'Lauren Tan', licence: 'Apache-2.0', source: 'https://github.com/cursor/plugins/tree/8b3326d99fd4/pstack/skills/unslop', date: '2026-10-22' },
  ]);
});

test('a skill UPSTREAM.md doesn’t list is Lar’s own and links its folder in lar-factory', async (t) => {
  const bundle = await bundleWith(t, ['lar-work'], []);
  assert.deepEqual(readBundledSkills(bundle), [
    { name: 'lar-work', author: 'Lar', licence: 'MIT', source: 'https://github.com/maddec01/lar-factory/tree/main/skills/lar-work' },
  ]);
});

test('each checklist gets a row linking its file, and references/LICENSE gets none', async (t) => {
  const bundle = await bundleWith(t, [], ['LICENSE', 'security-checklist.md']);
  assert.deepEqual(readBundledSkills(bundle), [
    { name: 'references/security-checklist.md', author: 'Addy Osmani', licence: 'MIT', source: 'https://github.com/addyosmani/agent-skills/blob/aeac41d4d005/references/security-checklist.md', date: '2026-10-13' },
  ]);
});

test('a source the Authors line misses shows its owner and an unknown licence', async (t) => {
  const bundle = await bundleWith(t, ['tdd'], [], UPSTREAM.replace(/^Authors:.*$/m, ''));
  assert.deepEqual(readBundledSkills(bundle)[0], {
    name: 'tdd', author: 'mattpocock', licence: 'Unknown licence', source: 'https://github.com/mattpocock/skills/tree/5beb35b040e3/skills/engineering/tdd', date: '2026-10-19',
  });
});

test('skills come first, each kind sorted by name', async (t) => {
  const bundle = await bundleWith(t, ['unslop', 'lar-work', 'tdd'], ['security-checklist.md']);
  assert.deepEqual(readBundledSkills(bundle).map((s) => s.name), ['lar-work', 'tdd', 'unslop', 'references/security-checklist.md']);
});

test('the checkout’s bundle lists every skill folder, and every Copy has an author', () => {
  const skills = readBundledSkills(fileURLToPath(BUNDLE_URL));
  assert.ok(skills.some((s) => s.name === 'lar-work' && s.author === 'Lar'));
  assert.ok(skills.some((s) => s.name === 'developer-profile' && s.author === 'Lar'));
  assert.ok(!skills.some((s) => s.name === 'references/LICENSE'));
  assert.deepEqual(skills.filter((s) => s.licence !== 'MIT'), []);
});

test('BOARD_BUNDLE_DIR names the bundle; the checkout root is the default', () => {
  assert.equal(bundleUrl({ BOARD_BUNDLE_DIR: '/app/bundle' }).href, 'file:///app/bundle/');
  assert.equal(bundleUrl({}), BUNDLE_URL);
});

/** A home whose install manifest holds `status`. */
async function homeWith(t: TestContext, status: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'lar bundled skills home '));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.agents'));
  await writeFile(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '1.0.0', skills: ['lar-work', 'tdd'], status }));
  return home;
}

test('each skill gets its state from the install manifest; a checklist and a skill it doesn’t name get none', async (t) => {
  const bundle = await bundleWith(t, ['grill', 'lar-work', 'tdd'], ['security-checklist.md']);
  const home = await homeWith(t, { 'lar-work': { state: 'matching' }, tdd: { state: 'restored', restoredAt: '2026-10-26T09:30:00.000Z' }, unslop: { state: 'blocked', paths: [{ place: 'agents', path: '/home/.agents/skills/unslop' }] } });
  assert.deepEqual(withInstallState(readBundledSkills(bundle), home).map((s) => [s.name, s.status]), [
    ['grill', undefined], ['lar-work', { state: 'matching' }], ['tdd', { state: 'restored', restoredAt: '2026-10-26T09:30:00.000Z' }],
    ['references/security-checklist.md', undefined]]);
});

test('without a manifest, or with one it can’t read, no skill has a state', async (t) => {
  const bundle = await bundleWith(t, ['tdd'], []);
  const skills = readBundledSkills(bundle);
  const empty = await mkdtemp(join(tmpdir(), 'lar bundled skills home '));
  t.onTestFinished(() => rm(empty, { recursive: true, force: true }));
  assert.deepEqual(withInstallState(skills, empty), skills);
  const broken = await homeWith(t, {});
  await writeFile(join(broken, '.agents', INSTALL_MANIFEST), '{');
  assert.deepEqual(withInstallState(skills, broken), skills);
});

test('LAR_FACTORY_INSTALL_ROOT names the install home; the user’s home is the default', () => {
  assert.equal(installHome({ LAR_FACTORY_INSTALL_ROOT: '/tmp/lar' }, '/Users/me'), '/tmp/lar');
  assert.equal(installHome({}, '/Users/me'), '/Users/me');
});
