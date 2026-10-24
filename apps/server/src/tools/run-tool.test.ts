import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { runTool } from './run-tool.ts';

const node = (script: string) => ['-e', script];

test('a tool that succeeds gives code 0 and what it printed', async () => {
  assert.deepEqual(await runTool(process.execPath, node('process.stdout.write("out"); process.stderr.write("warn")'), { timeout: 5_000 }),
    { code: 0, stdout: 'out', stderr: 'warn', detail: '' });
});

test("a tool that fails gives its exit code and the first four lines of what it printed as the detail", async () => {
  const result = await runTool(process.execPath, node('console.error("\\n1\\n2\\n3\\n4\\n5"); process.exit(3)'), { timeout: 5_000 });
  assert.equal(result.code, 3);
  assert.equal(result.stderr, '\n1\n2\n3\n4\n5\n', 'stderr stays whole, for callers that match on all of it');
  assert.equal(result.detail, '1\n2\n3\n4');
  assert.equal((await runTool(process.execPath, node('console.log("only out"); process.exit(1)'), { timeout: 5_000 })).detail, 'only out',
    'stdout stands in when stderr is empty');
  assert.match((await runTool(process.execPath, node('process.exit(1)'), { timeout: 5_000 })).detail, /^Command failed/,
    "the error's message stands in when the tool printed nothing");
});

test('a missing binary gives the spawn error code; a timeout gives null', async () => {
  assert.equal((await runTool('/nonexistent/tool', [], { timeout: 5_000 })).code, 'ENOENT');
  assert.equal((await runTool(process.execPath, node('setTimeout(() => {}, 5_000)'), { timeout: 100 })).code, null);
});

test('the env and buffer limit reach the tool', async () => {
  const env = { ...process.env, RUN_TOOL_TEST: 'set' };
  assert.equal((await runTool(process.execPath, node('process.stdout.write(process.env.RUN_TOOL_TEST)'), { env, timeout: 5_000 })).stdout, 'set');
  assert.equal((await runTool(process.execPath, node('process.stdout.write("x".repeat(100))'), { timeout: 5_000, maxBuffer: 10 })).code,
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
});
