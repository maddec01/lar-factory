import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { readProjectTeams } from './project-teams.ts';

test('team choices read every project team without guessing from the project name', async () => {
    assert.deepEqual(
        await readProjectTeams({ repo: 'contoso/Fabrikam%20Fiber/api' }, async (args) => {
            assert.deepEqual(args, [
                'devops',
                'team',
                'list',
                '--organization',
                'https://dev.azure.com/contoso',
                '--project',
                'Fabrikam Fiber',
                '--output',
                'json',
            ]);

            return JSON.stringify([{ name: 'App' }, { name: 'Controls' }, { name: 'DepotAndTrading' }]);
        }),
        { teams: ['App', 'Controls', 'DepotAndTrading'] },
    );
});
