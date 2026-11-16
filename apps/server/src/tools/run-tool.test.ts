import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { runTool } from './run-tool.ts';

const node = (script: string) => ['-e', script];

test('a tool that fails gives its exit code and the first four lines of what it printed as the detail', async () => {
    const result = await runTool(process.execPath, node('console.error("\\n1\\n2\\n3\\n4\\n5"); process.exit(3)'), {
        timeout: 5_000,
    });

    assert.equal(result.code, 3);
    assert.equal(result.stderr, '\n1\n2\n3\n4\n5\n', 'stderr stays whole, for callers that match on all of it');
    assert.equal(result.detail, '1\n2\n3\n4');
    assert.equal(
        (await runTool(process.execPath, node('console.log("only out"); process.exit(1)'), { timeout: 5_000 })).detail,
        'only out',
        'stdout stands in when stderr is empty',
    );
    assert.match(
        (await runTool(process.execPath, node('process.exit(1)'), { timeout: 5_000 })).detail,
        /^Command failed/,
        "the error's message stands in when the tool printed nothing",
    );
});
