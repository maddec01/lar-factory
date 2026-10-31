import { expect, it } from 'vite-plus/test';
import { readExecution, readThreadFamily, subscribeExecution, subscribeExecutionShell, executionCapabilities } from './execution-protocol.ts';
import { ProjectProtocol } from './project-protocol.ts';
const protocol = new ProjectProtocol({ read: async () => undefined, write: async () => {} },
  { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => new Response(), 'unknown');
it('reports unsupported lookup and family without credentials or waiting for timeout', async () => {
  const origin = new URL('http://127.0.0.1:3773');
  expect(await readExecution(origin, 'unknown', protocol, 'thread')).toEqual({ availability: 'unsupported-version', observation: undefined });
  expect(await readThreadFamily(origin, 'unknown', protocol, 'thread')).toEqual({ availability: 'unsupported-version' });
});
it('refuses external origins before obtaining a session', () => {
  expect(() => subscribeExecution(new URL('http://example.com'), 'unknown', protocol, 'thread', () => {})).toThrow('Expected local T3 server');
});

it('reports exact capability gaps and rejects external shell origins', () => {
  expect(executionCapabilities.azurePolicies).toBe(false);
  expect(executionCapabilities.transcriptUsage).toBe(false);
  expect(() => subscribeExecutionShell(new URL('http://example.com'), 'unknown', protocol, () => {})).toThrow('Expected local T3 server');
});
