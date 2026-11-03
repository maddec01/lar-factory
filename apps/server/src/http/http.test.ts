import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import { createBoardState } from '../board/board-state.ts';
import type { ProjectImage } from '../t3/project-icons.ts';
import { createBoardServer, type HttpDeps } from './http.ts';

let close: (() => Promise<unknown>) | undefined;
afterEach(() => close?.());

async function serve(projectIcon: (projectId: string) => Promise<ProjectImage | undefined>) {
  const lookup = vi.fn(projectIcon);
  const { server } = createBoardServer({
    board: createBoardState({ repos: [], items: [] } as unknown as BoardData),
    page: { template: '<html></html>', assets: new Map() },
    ready: () => undefined,
    projectIcon: lookup,
  } as unknown as HttpDeps);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  close = () => new Promise(resolve => server.close(resolve));
  const { port } = server.address() as AddressInfo;
  return { lookup, get: (path: string) => fetch(`http://127.0.0.1:${port}${path}`) };
}

const png = { type: 'image/png', body: Buffer.from('png bytes') };

it('sends a listed project\'s favicon with its checked type, nosniff and long caching, and no SVG policy', async () => {
  const { get, lookup } = await serve(async () => png);
  const response = await get('/api/project-icon/project%3Aone?v=abc');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('png bytes');
  expect(lookup).toHaveBeenCalledWith('project:one');
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toContain('max-age=31536000');
  expect(response.headers.get('content-security-policy')).toBeNull();
});

it('sends an SVG under T3\'s policy', async () => {
  const { get } = await serve(async () => ({ type: 'image/svg+xml', body: Buffer.from('<svg/>') }));
  const response = await get('/api/project-icon/one');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
});

it('answers 404 for an unlisted ID, one with no bytes and a malformed one', async () => {
  const { get } = await serve(async () => undefined);
  expect((await get('/api/project-icon/unlisted')).status).toBe(404);
  expect((await get('/api/project-icon/%E0%A4%A')).status).toBe(404);
  expect((await get('/api/project-icon/')).status).toBe(404);
});

it('leaves the page\'s security headers as they were', async () => {
  const { get } = await serve(async () => undefined);
  const response = await get('/');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
});
