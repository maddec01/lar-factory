import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { choiceOf, startRequest } from './start-menu.ts';

test('picking "Project default in T3" posts no model choice; picking a model posts its instance id and slug', () => {
    assert.deepEqual(startRequest('s1', 'I_1', choiceOf({})), { session: 's1', itemId: 'I_1' });
    assert.deepEqual(
        startRequest('s1', 'I_1', choiceOf({ instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' })),
        { session: 's1', itemId: 'I_1', model: { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' } },
    );
});
