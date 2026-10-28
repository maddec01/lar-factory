import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { readProjectTeams } from './project-teams.ts';

test('team choices read every project team without guessing from the project name', async () => {
  assert.deepEqual(await readProjectTeams({ repo: 'contoso/Fabrikam%20Fiber/api' }, async (args) => {
    assert.deepEqual(args, ['devops', 'team', 'list', '--organization', 'https://dev.azure.com/contoso', '--project', 'Fabrikam Fiber', '--output', 'json']);
    return JSON.stringify([{ name: 'App' }, { name: 'Controls' }, { name: 'DepotAndTrading' }]);
  }), { teams: ['App', 'Controls', 'DepotAndTrading'] });
});

test('team discovery refuses invalid repositories and reports read failures', async () => {
  const never = async () => { throw new Error('should not run'); };
  for (const repo of ['../x', 'owner/repo']) assert.equal((await readProjectTeams({ repo }, never) as { status: number }).status, 400);
  assert.deepEqual(await readProjectTeams({ repo: 'contoso/Fabrikam/api' }, async () => { throw new Error('Sign in with az'); }),
    { status: 502, error: "Can't load teams. Sign in with az" });
});
