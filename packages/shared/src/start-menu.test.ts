import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { choiceOf, readChoice, startRequest, storedChoice } from './start-menu.ts';

test('picking "Project default in T3" posts no model choice; picking a model posts its instance id and slug', () => {
    assert.deepEqual(startRequest('s1', 'I_1', choiceOf({})), { session: 's1', itemId: 'I_1' });
    assert.deepEqual(
        startRequest('s1', 'I_1', choiceOf({ instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' })),
        { session: 's1', itemId: 'I_1', model: { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' } },
    );
});

test('a stored choice reads back as it was stored; "Project default in T3" or anything unreadable reads as none', () => {
    const choice = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5[1m]' };

    assert.deepEqual(readChoice(storedChoice(choice)), choice);
    assert.equal(readChoice(storedChoice(undefined)), undefined);
    for (const raw of [null, '', 'not json', '42', '{"instanceId":"codex"}', '{"instanceId":1,"model":"gpt-5.5"}'])
        assert.equal(readChoice(raw), undefined, String(raw));
});
