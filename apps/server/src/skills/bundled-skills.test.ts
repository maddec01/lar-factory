import { agentSetupWrites } from '../onboarding/agent-setup.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_MANIFEST } from '@lar-factory/shared/install-skills';
import { BUNDLE_URL, bundleUrl, bundledSkillNames, installHome, readBundledSkills, withInstallState } from './bundled-skills.ts';

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

test('the assembled bundle installs only Lar skills with shared copies and nested checklists', () => {
  const root = fileURLToPath(BUNDLE_URL);
  assert.deepEqual(bundledSkillNames().sort(), ['lar-build', 'lar-shape']);
  const rows = readBundledSkills(root);
  assert.deepEqual(rows.map((row) => row.name).sort(), ['lar-build', 'lar-shape']);
  for (const row of rows) {
    assert.equal(row.author, 'Lar');
    assert.ok(row.includedAuthors?.length);
    assert.ok(row.notices?.endsWith('/THIRD_PARTY_NOTICES.md'));
    for (const file of readdirSync(new URL('../../../../skills/shared/', import.meta.url), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())) {
      const source = join(file.parentPath, file.name);
      const relative = source.split('/skills/shared/')[1]!;
      assert.deepEqual(readFileSync(join(root, 'skills', row.name, 'shared', relative)), readFileSync(source));
    }
  }
});

/** A home whose install manifest holds `status`. */
async function homeWith(t: TestContext, status: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'lar bundled skills home '));
  t.onTestFinished(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.agents'));
  await writeFile(join(home, '.agents', INSTALL_MANIFEST), JSON.stringify({ version: '1.0.0', skills: ['lar-work', 'tdd'], status }));
  return home;
}

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

test('generated provider guidance points to files in the assembled skill', () => {
  const root = fileURLToPath(BUNDLE_URL);
  for (const provider of ['GitHub', 'Azure DevOps'] as const) {
    const content = agentSetupWrites({}, provider).map((file) => file.content).join('\n');
    for (const match of content.matchAll(/(?:lar-shape\/|<lar-shape>\/)([\w/.-]+\.(?:md|sh))/g)) {
      assert.ok(readFileSync(join(root, 'skills', 'lar-shape', match[1]!)).length);
    }
    for (const match of content.matchAll(/(?:shared\/)?scripts\/[\w-]+\.sh/g)) {
      assert.ok(readFileSync(join(root, 'skills', 'lar-shape', match[0])).length);
    }
  }
});
