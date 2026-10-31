import { test, vi, expect } from 'vite-plus/test';
import { repositoryProjects, reauthorizeRepositoryProjects } from './repository-project-discovery.ts';

const fixture = vi.hoisted(() => ({ read: { availability: 'available', observation: { projects: [], observedAt: '2026-10-31T00:00:00Z' } } as import('./project-protocol.ts').ProjectRead, renew: vi.fn(async () => {}), stop: vi.fn(), notify: (_read: import('./project-protocol.ts').ProjectRead) => {} }));
vi.mock('../json-file.ts', () => ({ readJsonRecord: () => ({ origin: 'http://127.0.0.1:3773', serverVersion: undefined }) }));
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture/runtime', t3Running: () => true }));
vi.mock('./board-projects.ts', () => ({ boardProjects: () => ({ readProjects: async () => fixture.read, reauthorize: fixture.renew }) }));
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
