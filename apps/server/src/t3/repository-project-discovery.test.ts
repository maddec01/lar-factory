import { test, vi, expect } from 'vite-plus/test';
import { repositoryProjects } from './repository-project-discovery.ts';

const fixture = vi.hoisted(() => ({ read: { availability: 'available', observation: { projects: [], observedAt: '2026-10-31T00:00:00Z' } } as import('./project-protocol.ts').ProjectRead, notify: (_read: import('./project-protocol.ts').ProjectRead) => {} }));
vi.mock('../json-file.ts', () => ({ readJsonRecord: () => ({ origin: 'http://127.0.0.1:3773', serverVersion: 'fixture' }) }));
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture/runtime', t3Running: () => true }));
vi.mock('./board-projects.ts', () => ({ boardProjects: () => ({ readProjects: async () => fixture.read }) }));
vi.mock('./project-subscription.ts', () => ({ subscribeProjects: (_origin: URL, _version: string, _protocol: unknown, notify: typeof fixture.notify) => { fixture.notify = notify; return () => {}; } }));

test('successful empty discovery stays distinct from disconnect and retains its observation', async () => {
  const first = await repositoryProjects();
  expect(first.availability).toBe('available');
  expect(first.observation?.projects).toEqual([]);
  fixture.notify({ availability: 'unavailable' });
  const disconnected = await repositoryProjects();
  expect(disconnected.availability).toBe('unavailable');
  expect(disconnected.observation?.observedAt).toBe('2026-10-31T00:00:00Z');
});
