import { execFile } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { assertAzureCommandAllowed, assertAzureThreadAllowed } from './azure-safety.ts';
import { providerCommand } from './provider-command.ts';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

const readonly = { LAR_FACTORY_AZURE_READ_ONLY: '1' };
const invoke = (area: string, resource: string, method?: string) => [
    'devops',
    'invoke',
    '--area',
    area,
    '--resource',
    resource,
    ...(method ? ['--http-method', method] : []),
    '--org',
    'https://dev.azure.com/contoso',
];

test.each([['repos', 'pr', 'list'], invoke('wit', 'wiql', 'POST')])('allows a known Azure read: %j', (...args) => {
    expect(() => assertAzureCommandAllowed(args, readonly)).not.toThrow();
});

const writes = [
    ['boards', 'work-item', 'create'],
    [...invoke('wit', 'tags', 'GET'), '--http-method=PATCH'],
    ['rest', '--method', 'get', '--url', 'https://dev.azure.com/contoso/_apis/unknown'],
];

test.each(writes)('refuses Azure writes and unknown commands before publication can spawn: %j', async (...args) => {
    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
    await expect(providerCommand('az', args)).rejects.toThrow('read-only');
    expect(execFile).not.toHaveBeenCalled();
});

test('normal sessions keep their existing write access; read-only sessions refuse only Azure threads', () => {
    expect(() => assertAzureCommandAllowed(writes[0]!, {})).not.toThrow();
    expect(() => assertAzureThreadAllowed('contoso/project/repo', readonly)).toThrow('Agent threads cannot start');
    expect(() => assertAzureThreadAllowed('owner/repo', readonly)).not.toThrow();
    expect(() => assertAzureThreadAllowed('contoso/project/repo', {})).not.toThrow();
});
