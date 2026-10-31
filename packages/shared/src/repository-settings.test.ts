import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { readRepositorySetups, setOverride, writeListFile } from './repository-settings.ts';

test('structural saving is additive to legacy settings and survives existing settings updates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'structure-settings-'));
  try {
    writeListFile(dir, { repositories: [{ repo: 'team/app', settings: {
      structureSync: false,
      shared: { role: 'Shared role' },
      accepted: { itemSource: { kind: 'issues' }, domainDocs: { kind: 'private' } },
      consent: ['push-branch'],
      dismissedUpdate: 2,
    } }] });
    setOverride('team/app', 'labels', ['backend'], dir);
    expect(readRepositorySetups(dir)[0]).toMatchObject({
      structureSync: false, role: 'Shared role', labels: ['backend'],
      shared: { role: 'Shared role' }, sources: { role: 'shared', labels: 'local' },
      paused: [], consent: ['push-branch'],
    });
    writeListFile(dir, { repositories: [{ repo: 'team/app' }] });
    expect(readRepositorySetups(dir)[0]?.structureSync).toBeUndefined();
    writeFileSync(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [{ repo: 'team/app', settings: { structureSync: 'false' } }] }));
    expect(() => readRepositorySetups(dir)).toThrow('local settings');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
