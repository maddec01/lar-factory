import { afterEach, expect, test, vi } from 'vite-plus/test';
import { az } from './azure-items.ts';
import { runTool } from '../tools/run-tool.ts';

vi.mock('../tools/run-tool.ts', () => ({ runTool: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

test('the board refuses Azure writes before looking up or spawning az', async () => {
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  await expect(az(['repos', 'pr', 'create', '--org', 'https://dev.azure.com/contoso'])).rejects.toThrow('read-only');
  await expect(az(['devops', 'invoke', '--area', 'git', '--resource', 'pushes', '--http-method', 'POST'])).rejects.toThrow('read-only');
  expect(runTool).not.toHaveBeenCalled();
});
