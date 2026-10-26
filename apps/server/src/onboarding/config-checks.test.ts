import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { createConfigChecks } from './config-checks.ts';

/** A gh that answers each repository's .lar-factory.json read from `files`, and the repositories it was asked for. */
function gh(files: Record<string, 'file' | 'none' | 'fails'>) {
  const asked: string[] = [];
  const run = async (args: string[]) => {
    const repo = args[1]!.match(/^repos\/(.+)\/contents\/\.lar-factory\.json$/)![1]!;
    asked.push(repo);
    if (files[repo] === 'file') return '{"role":"Web client"}';
    throw new Error(files[repo] === 'none' ? 'gh: Not Found (HTTP 404)' : 'HTTP 502: Bad Gateway');
  };
  return { run, asked };
}

test("each repository's answer is read once and kept until the checks clear", async () => {
  const { run, asked } = gh({ 'maddec01/lar-web': 'file', 'maddec01/lar-server': 'none' });
  const checks = createConfigChecks(run, () => {});
  const web = { hasConfig: true, config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client' } };
  assert.deepEqual(await Promise.all([checks.configOf('maddec01/lar-web'), checks.configOf('maddec01/lar-server'), checks.configOf('Maddec01/Lar-Web')]),
    [web, { hasConfig: false }, web]);
  assert.deepEqual(await Promise.all([checks.configOf('maddec01/lar-web'), checks.configOf('maddec01/lar-server')]), [web, { hasConfig: false }]);
  assert.deepEqual(asked, ['maddec01/lar-web', 'maddec01/lar-server']);
  checks.clear();
  await checks.configOf('maddec01/lar-web');
  assert.deepEqual(asked, ['maddec01/lar-web', 'maddec01/lar-server', 'maddec01/lar-web']);
});

test("forgetting a repository reads only its answer again", async () => {
  const { run, asked } = gh({ 'maddec01/lar-web': 'file', 'maddec01/lar-server': 'none' });
  const checks = createConfigChecks(run, () => {});
  await Promise.all([checks.configOf('maddec01/lar-web'), checks.configOf('maddec01/lar-server')]);
  checks.forget('Maddec01/Lar-Server');
  await Promise.all([checks.configOf('maddec01/lar-web'), checks.configOf('maddec01/lar-server')]);
  assert.deepEqual(asked, ['maddec01/lar-web', 'maddec01/lar-server', 'maddec01/lar-server']);
});

test('a check that fails answers hasConfig null, logs a line once while it keeps failing, and is tried again next time', async () => {
  const files: Record<string, 'file' | 'fails'> = { 'maddec01/lar-web': 'fails' };
  const { run, asked } = gh(files);
  const lines: string[] = [];
  const checks = createConfigChecks(run, (line) => lines.push(line));
  assert.deepEqual(await checks.configOf('maddec01/lar-web'), { hasConfig: null });
  assert.deepEqual(await checks.configOf('maddec01/lar-web'), { hasConfig: null });
  assert.deepEqual(lines, ["can't tell whether maddec01/lar-web has .lar-factory.json: HTTP 502: Bad Gateway"]);
  files['maddec01/lar-web'] = 'file';
  assert.equal((await checks.configOf('maddec01/lar-web')).hasConfig, true);
  assert.equal(asked.length, 3);
});
