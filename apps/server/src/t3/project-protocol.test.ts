import { expect, it } from 'vite-plus/test';
import { ProjectProtocol, type BoardSession } from './project-protocol.ts';

it('retains the observation after rejection and reports renewal failure', async () => {
  let session: BoardSession | undefined;
  let rejected = false;
  let fail = false;
  const adapter = new ProjectProtocol({ read: async () => session, write: async value => { session = value; } }, {
    issue: async () => { if (fail) throw Error('private'); return { token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }; },
    revoke: async () => {},
  }, async () => rejected ? new Response('', { status: 401 }) : Response.json({ projects: [], updatedAt: '2026-01-01' }), 'fixture-release');
  const first = await adapter.readProjects();
  expect(first.availability).toBe('available');
  rejected = true;
  expect(await adapter.readProjects()).toEqual({ availability: 'renewal-required', observation: first.observation });
  session = undefined;
  fail = true;
  expect((await adapter.readProjects()).availability).toBe('renewal-required');
});

it.each(['0.1.6-nightly.20261031.3977', '1.0.0', 'unknown', ''])('reads compatible projects on T3 %s', async version => {
  const adapter = new ProjectProtocol({ read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }), write: async () => {} }, { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => Response.json({ projects: [{ id: 'repo', title: 'Repository', workspaceRoot: '/repo', futureField: true }], updatedAt: '2026-01-01', futureField: true }), version);
  expect((await adapter.readProjects()).observation?.projects).toEqual([{ id: 'repo', title: 'Repository', workspaceRoot: '/repo' }]);
});

it('rejects remote endpoints before sending credentials', async () => {
  const { boardProjects } = await import('./board-projects.ts');
  expect(() => boardProjects('https://example.com', 'fixture-release')).toThrow('Expected local T3 server');
});

it.each(['fixture-release', '0.1.6-nightly.20261031.3977', 'unknown'])('reports malformed snapshots on T3 %s', async version => {
  const adapter = new ProjectProtocol({ read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }), write: async () => {} }, { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => Response.json({ projects: [{}], updatedAt: '2026-01-01' }), version);
  expect((await adapter.readProjects()).availability).toBe('malformed');
});

it('revokes a newly issued session if Keychain storage fails', async () => {
  const revoked: string[] = [];
  const adapter = new ProjectProtocol({ read: async () => undefined, write: async () => { throw Error('locked'); } }, {
    issue: async () => ({ token: 'fixture', sessionId: 'new', expiresAt: '2099-01-01' }),
    revoke: async id => { revoked.push(id); },
  }, async () => { throw Error('must not request'); }, 'fixture-release');
  expect((await adapter.readProjects()).availability).toBe('renewal-required');
  expect(revoked).toEqual(['new']);
});

it('renews before expiry, persists the replacement, and revokes the old session', async () => {
  const events: string[] = [];
  const adapter = new ProjectProtocol({
    read: async () => ({ token: 'old-fixture', sessionId: 'old', expiresAt: new Date(30_000).toISOString() }),
    write: async session => { events.push(`stored:${session.sessionId}`); },
  }, {
    issue: async () => ({ token: 'new-fixture', sessionId: 'new', expiresAt: new Date(3_600_000).toISOString() }),
    revoke: async id => { events.push(`revoked:${id}`); },
  }, async token => { expect(token).toBe('new-fixture'); return Response.json({ projects: [], updatedAt: '2026-01-01' }); }, 'fixture-release', () => 0);
  expect((await adapter.readProjects()).availability).toBe('available');
  expect(events).toEqual(['stored:new', 'revoked:old']);
});


it('does not replace a newer observation with an older server snapshot', async () => {
  let updatedAt = '2026-10-31T12:00:00Z';
  const adapter = new ProjectProtocol({ read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }), write: async () => {} }, { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => Response.json({ projects: [{ id: updatedAt, title: 'Repository', workspaceRoot: '/repo' }], updatedAt }), 'fixture-release');
  const first = await adapter.readProjects();
  updatedAt = '2026-10-30T12:00:00Z';
  expect(await adapter.readProjects()).toEqual({ availability: 'malformed', observation: first.observation });
});

it('retains the last observation when the projects endpoint disappears', async () => {
  let missing = false;
  const adapter = new ProjectProtocol({ read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }), write: async () => {} }, { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => missing ? new Response('', { status: 404 }) : Response.json({ projects: [], updatedAt: '2026-01-01' }), 'future-release');
  const first = await adapter.readProjects();
  missing = true;
  expect(await adapter.readProjects()).toEqual({ availability: 'unavailable', observation: first.observation });
});
