import { onTestFinished, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { startFakeT3 } from '../test/fake-t3.ts';
import { discoverProviderInstances, installTargets } from './install-targets.ts';

const HOME = '/Users/someone';

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'install-targets-'));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

const provider = (instanceId: string, driver: string, enabled: boolean, displayName?: string) =>
  ({ instanceId, driver, enabled, installed: true, ...(displayName ? { displayName } : {}) });

/** T3's answer on a machine with a custom-home Claude instance, a Pi instance with its own HOME, and built-in defaults. */
const config = {
  providers: [
    provider('codex', 'codex', true, 'Codex'),
    provider('claudeAgent', 'claudeAgent', true, 'Claude'),
    provider('claudeAgent_work', 'claudeAgent', true, 'Work'),
    provider('antigravity', 'antigravity', false, 'Antigravity'),
    provider('cursor', 'cursor', false),
    provider('pi_sandbox', 'pi', true, 'Pi sandbox'),
    provider('acp_thing', 'acpRegistry', true, 'Something new'),
  ],
  settings: {
    providerInstances: {
      claudeAgent: { driver: 'claudeAgent', config: { homePath: '' } },
      claudeAgent_work: { driver: 'claudeAgent', config: { homePath: '~/work/claude' } },
      pi_sandbox: { driver: 'pi', environment: [{ name: 'HOME', value: '/Volumes/sandbox-home', sensitive: false }, { name: 'PI_TOKEN', value: 'secret', sensitive: true }] },
    },
  },
};

test('maps each driver to the folders it reads its user skills from', () => {
  assert.deepEqual(installTargets('claudeAgent', HOME), [{ kind: 'claude', path: `${HOME}/.claude/skills` }]);
  assert.deepEqual(installTargets('antigravity', HOME), [
    { kind: 'antigravity', path: `${HOME}/.gemini/config/skills` },
    { kind: 'antigravity', path: `${HOME}/.gemini/antigravity-cli/skills` },
  ]);
  for (const driver of ['codex', 'cursor', 'grok', 'opencode', 'fx', 'muse', 'pi']) {
    assert.deepEqual(installTargets(driver, HOME), [{ kind: 'agents', path: `${HOME}/.agents/skills` }], driver);
  }
  assert.deepEqual(installTargets('acpRegistry', HOME), []);
});

test("puts a Claude instance's skills in its homePath, with ~ standing for the user's home", () => {
  assert.deepEqual(installTargets('claudeAgent', HOME, { config: { homePath: '~/.claude-personal' } }), [{ kind: 'claude', path: `${HOME}/.claude-personal/skills` }]);
  assert.deepEqual(installTargets('claudeAgent', HOME, { config: { homePath: ' /opt/claude ' } }), [{ kind: 'claude', path: '/opt/claude/skills' }]);
});

test("never targets a Codex instance's CODEX_HOME", () => {
  assert.deepEqual(installTargets('codex', HOME, { config: { homePath: '/opt/codex' } }), [{ kind: 'agents', path: `${HOME}/.agents/skills` }]);
});

test("resolves the user's home from an instance's HOME and from no other variable", () => {
  const environment = [{ name: 'HOME', value: '/Volumes/other' }, { name: 'CLAUDE_CONFIG_DIR', value: '/elsewhere' }, { name: 'XDG_CONFIG_HOME', value: '/xdg' }];
  assert.deepEqual(installTargets('pi', HOME, { environment }), [{ kind: 'agents', path: '/Volumes/other/.agents/skills' }]);
  assert.deepEqual(installTargets('claudeAgent', HOME, { environment }), [{ kind: 'claude', path: '/Volumes/other/.claude/skills' }]);
  // T3 hides a sensitive value, and a relative HOME names no home.
  assert.deepEqual(installTargets('pi', HOME, { environment: [{ name: 'HOME', value: '', sensitive: true }] }), [{ kind: 'agents', path: `${HOME}/.agents/skills` }]);
  assert.deepEqual(installTargets('pi', HOME, { environment: [{ name: 'HOME', value: 'relative' }] }), [{ kind: 'agents', path: `${HOME}/.agents/skills` }]);
});

test("discovers every instance T3's server.getConfig lists, default and disabled ones too, with their targets", async () => {
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.deepEqual(found, {
    available: true,
    instances: [
      { id: 'codex', driver: 'codex', displayName: 'Codex', enabled: true, targets: [{ kind: 'agents', path: `${HOME}/.agents/skills` }] },
      { id: 'claudeAgent', driver: 'claudeAgent', displayName: 'Claude', enabled: true, targets: [{ kind: 'claude', path: `${HOME}/.claude/skills` }] },
      { id: 'claudeAgent_work', driver: 'claudeAgent', displayName: 'Work', enabled: true, targets: [{ kind: 'claude', path: `${HOME}/work/claude/skills` }] },
      { id: 'antigravity', driver: 'antigravity', displayName: 'Antigravity', enabled: false, targets: [
        { kind: 'antigravity', path: `${HOME}/.gemini/config/skills` },
        { kind: 'antigravity', path: `${HOME}/.gemini/antigravity-cli/skills` },
      ] },
      { id: 'cursor', driver: 'cursor', displayName: 'cursor', enabled: false, targets: [{ kind: 'agents', path: `${HOME}/.agents/skills` }] },
      { id: 'pi_sandbox', driver: 'pi', displayName: 'Pi sandbox', enabled: true, targets: [{ kind: 'agents', path: '/Volumes/sandbox-home/.agents/skills' }] },
      { id: 'acp_thing', driver: 'acpRegistry', displayName: 'Something new', enabled: true, targets: [] },
    ],
  });
});

test('asks T3 with a short-lived read-only session and revokes it afterwards', async () => {
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  const issue = t3.calls.find((args) => args[2] === 'issue');
  assert.deepEqual(issue, ['auth', 'session', 'issue', '--scope', 'orchestration:read', '--ttl', '1m', '--label', 'Lar Factory', '--json']);
  await vi.waitFor(() => assert.deepEqual(t3.revoked, ['fake-session-id']));
});

test("keeps an instance's environment out of what it returns and logs", async () => {
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  onTestFinished(() => logs.forEach((spy) => spy.mockRestore()));
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  const text = JSON.stringify(found);
  assert.equal(text.includes('/Volumes/sandbox-home"'), false, 'the HOME value itself');
  assert.equal(text.includes('secret'), false);
  assert.equal(text.includes('environment'), false);
  for (const spy of logs) assert.equal(spy.mock.calls.length, 0);
});

test('says T3 is unavailable when its runtime file is missing', async () => {
  const found = await discoverProviderInstances({ home: HOME, runtimePath: join(temporary(), 'missing.json'), runT3: async () => ({ code: 0, stdout: '' }) });
  assert.deepEqual(found, { available: false, reason: 'not-running' });
});

test('says T3 is unavailable when it rejects the session', async () => {
  const t3 = await startFakeT3(temporary(), { config, rejectToken: true }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.deepEqual(found, { available: false, reason: 'unauthenticated' });
  await vi.waitFor(() => assert.deepEqual(t3.revoked, ['fake-session-id']));
});

test('says T3 is unavailable when the CLI cannot issue a session', async () => {
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: async () => ({ code: 1, stdout: '' }) });
  assert.deepEqual(found, { available: false, reason: 'unauthenticated' });
});

test('gives up within its timeout when T3 does not answer', async () => {
  const t3 = await startFakeT3(temporary(), { config, hang: true }, onTestFinished);
  const started = Date.now();
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3, timeoutMs: 300 });
  assert.deepEqual(found, { available: false, reason: 'timed-out' });
  assert.ok(Date.now() - started < 1_000);
  await vi.waitFor(() => assert.deepEqual(t3.revoked, ['fake-session-id']));
});

test('gives up within its timeout when the CLI hangs', async () => {
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  const started = Date.now();
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: () => new Promise(() => {}), timeoutMs: 300 });
  assert.deepEqual(found, { available: false, reason: 'timed-out' });
  assert.ok(Date.now() - started < 1_000);
});

test('says T3 is unavailable when nothing listens at its origin', async () => {
  const dir = temporary();
  const t3 = await startFakeT3(dir, { config }, (close) => close());
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.deepEqual(found, { available: false, reason: 'not-running' });
});

test("says T3 is unavailable when its answer isn't a config", async () => {
  const t3 = await startFakeT3(temporary(), { config: { providers: 'none' } }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.deepEqual(found, { available: false, reason: 'failed' });
});

test("says T3 is unavailable when it sends a frame that isn't JSON", async () => {
  const t3 = await startFakeT3(temporary(), { config, garbage: true }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.deepEqual(found, { available: false, reason: 'failed' });
});

test('never sends a token to an origin off this machine', async () => {
  const dir = temporary();
  const t3 = await startFakeT3(dir, { config }, onTestFinished);
  for (const origin of ['http://example.com:4000', 'http://10.0.0.2:4000', 'http://localhost.example.com:4000']) {
    writeFileSync(t3.runtimePath, JSON.stringify({ origin }));
    const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
    assert.deepEqual(found, { available: false, reason: 'failed' }, origin);
  }
  assert.deepEqual(t3.calls, []);
});

test('never follows a redirect with the token', async () => {
  const followed: Array<string | undefined> = [];
  const elsewhere = createServer((request, response) => {
    followed.push(request.headers.authorization);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"ticket":"stolen"}');
  });
  await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => { elsewhere.close(); });
  const { port } = elsewhere.address() as AddressInfo;
  const t3 = await startFakeT3(temporary(), { config, redirectTo: `http://127.0.0.1:${port}/api/auth/websocket-ticket/rpc` }, onTestFinished);
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.equal(found.available, false);
  assert.deepEqual(followed, []);
});

test('asks a T3 at localhost', async () => {
  const t3 = await startFakeT3(temporary(), { config }, onTestFinished);
  const { port } = new URL(JSON.parse(readFileSync(t3.runtimePath, 'utf8')).origin);
  writeFileSync(t3.runtimePath, JSON.stringify({ origin: `http://localhost:${port}` }));
  const found = await discoverProviderInstances({ home: HOME, runtimePath: t3.runtimePath, runT3: t3.runT3 });
  assert.equal(found.available, true);
});
