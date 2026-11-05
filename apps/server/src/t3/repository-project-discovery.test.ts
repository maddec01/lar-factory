import { test, vi, expect } from 'vite-plus/test';
import { repositoryProjectAccess, repositoryProjects, reauthorizeRepositoryProjects, subscribeRepositoryProjects, useProjectSessions } from './repository-project-discovery.ts';

const fixture = vi.hoisted(() => ({ read: { availability: 'available', observation: { projects: [], observedAt: '2026-10-31T00:00:00Z' } } as import('./project-protocol.ts').ProjectRead, renew: vi.fn(async () => {}), stop: vi.fn(), running: vi.fn(() => true), sessions: vi.fn(), notify: (_read: import('./project-protocol.ts').ProjectRead) => {} }));
vi.mock('../json-file.ts', () => ({ readJsonRecord: () => ({ origin: 'http://127.0.0.1:3773', serverVersion: undefined }) }));
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture/runtime', t3Running: () => fixture.running() }));
vi.mock('./board-projects.ts', () => ({ boardProjects: (_origin: string, _version: string, sessions: unknown) => { fixture.sessions(sessions); return { readProjects: async () => fixture.read, reauthorize: fixture.renew }; } }));
vi.mock('./project-subscription.ts', () => ({ subscribeProjects: (_origin: URL, _version: string, _protocol: unknown, notify: typeof fixture.notify) => { fixture.notify = notify; return fixture.stop; } }));

test('successful empty discovery stays distinct from disconnect and retains its observation', async () => {
  const first = await repositoryProjects();
  expect(first.availability).toBe('available');
  expect(first.observation?.projects).toEqual([]);
  fixture.notify({ availability: 'unavailable' });
  const disconnected = await repositoryProjects();
  expect(disconnected.availability).toBe('unavailable');
  expect(disconnected.observation?.observedAt).toBe('2026-10-31T00:00:00Z');
  fixture.notify({ availability: 'malformed' });
  expect((await repositoryProjects()).availability).toBe('malformed');
  expect((await repositoryProjects()).observation).toEqual(first.observation);
});


test('reauthorization coalesces calls, restarts discovery and retains data on failure', async () => {
  fixture.notify({ availability: 'renewal-required' });
  const first = reauthorizeRepositoryProjects();
  const second = reauthorizeRepositoryProjects();
  expect(first).toBe(second);
  expect((await first).availability).toBe('available');
  expect(fixture.renew).toHaveBeenCalledTimes(1);
  expect(fixture.stop).toHaveBeenCalled();
  fixture.notify({ availability: 'renewal-required' });
  fixture.renew.mockRejectedValueOnce(new Error('private credential detail'));
  await expect(reauthorizeRepositoryProjects()).rejects.toThrow();
  expect((await repositoryProjects()).observation?.observedAt).toBe('2026-10-31T00:00:00Z');
});

test('access names the T3 origin and the session discovery holds, until T3 stops', async () => {
  await repositoryProjects();
  expect(repositoryProjectAccess()?.origin.href).toBe('http://127.0.0.1:3773/');
  expect(repositoryProjectAccess()?.protocol).toHaveProperty('readProjects');
  fixture.notify({ availability: 'unavailable' });
  fixture.running.mockReturnValue(false);
  await repositoryProjects();
  expect(repositoryProjectAccess()).toBeUndefined();
  fixture.running.mockReturnValue(true);
  await repositoryProjects();
  expect(repositoryProjectAccess()).toBeDefined();
});

test('asks whether T3\'s process lives only while its subscription shows no T3', async () => {
  fixture.read = { availability: 'available', observation: { projects: [], observedAt: '2026-10-31T00:00:00Z' } };
  await reauthorizeRepositoryProjects();
  fixture.running.mockClear();
  await repositoryProjects();
  await repositoryProjects();
  expect(fixture.running).not.toHaveBeenCalled();
  fixture.notify({ availability: 'unavailable' });
  await repositoryProjects();
  expect(fixture.running).toHaveBeenCalledTimes(1);
});

test('tells subscribers when project facts or availability change, not when only the observation time does', async () => {
  const project = { id: 'p', title: 'P', workspaceRoot: '/p', faviconPath: null, projectIcon: null };
  const shell = (observedAt: string, faviconPath: string | null = null) => ({ availability: 'available' as const, observation: { projects: [{ ...project, faviconPath }], observedAt } });
  fixture.read = shell('2026-11-03T00:00:00Z');
  await reauthorizeRepositoryProjects();
  const changed = vi.fn();
  const stop = subscribeRepositoryProjects(changed);

  fixture.notify(shell('2026-11-03T00:00:01Z'));
  expect(changed, 'the first shell data after a read counts, whatever it holds').toHaveBeenCalledTimes(1);
  fixture.notify(shell('2026-11-03T00:00:02Z'));
  expect(changed).toHaveBeenCalledTimes(1);
  fixture.notify(shell('2026-11-03T00:00:03Z', 'logo.png'));
  expect(changed).toHaveBeenCalledTimes(2);
  expect((await repositoryProjects()).observation?.projects[0]?.faviconPath, 'the subscriber can read the new data').toBe('logo.png');
  fixture.notify({ availability: 'unavailable' });
  expect(changed).toHaveBeenCalledTimes(3);
  fixture.notify({ availability: 'unavailable' });
  expect(changed).toHaveBeenCalledTimes(3);

  fixture.running.mockReturnValue(false);
  await repositoryProjects();
  expect(changed).toHaveBeenCalledTimes(3);
  fixture.running.mockReturnValue(true);
  await repositoryProjects();
  fixture.notify(shell('2026-11-03T00:00:04Z', 'logo.png'));
  expect(changed).toHaveBeenCalledTimes(4);

  stop();
  fixture.notify({ availability: 'malformed' });
  expect(changed).toHaveBeenCalledTimes(4);
});

test('reads with the Keychain session until told to use another', async () => {
  fixture.read = { availability: 'available', observation: { projects: [], observedAt: '2026-10-31T00:00:00Z' } };
  fixture.sessions.mockClear();
  await reauthorizeRepositoryProjects();
  expect(fixture.sessions).toHaveBeenLastCalledWith(undefined);
  const own = { vault: { read: async () => undefined, write: async () => {} }, authority: { issue: async () => { throw new Error('unused'); }, revoke: async () => {} } };
  useProjectSessions(own);
  await reauthorizeRepositoryProjects();
  expect(fixture.sessions).toHaveBeenLastCalledWith(own);
});
