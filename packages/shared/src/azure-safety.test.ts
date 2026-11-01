import { afterEach, expect, test, vi } from 'vite-plus/test';
import { assertAzureCommandAllowed, assertAzureThreadAllowed } from './azure-safety.ts';
import { providerCommand } from './provider-command.ts';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const readonly = { LAR_FACTORY_AZURE_READ_ONLY: '1' };
const invoke = (area: string, resource: string, method?: string) => ['devops', 'invoke', '--area', area, '--resource', resource,
  ...method ? ['--http-method', method] : [], '--org', 'https://dev.azure.com/contoso'];

test.each([
  ['version'], ['account', 'show'], ['extension', 'show', '--name', 'azure-devops'], ['devops', 'team', 'list'],
  ['repos', 'show'], ['repos', 'ref', 'list', '--filter', 'heads/main'], ['repos', 'pr', 'show'], ['repos', 'pr', 'list'],
  ['repos', 'pr', 'policy', 'list'], ['repos', 'pr', 'work-item', 'list'], ['boards', 'iteration', 'team', 'list'],
  ['boards', 'iteration', 'team', 'list-work-items'], invoke('work', 'backlogconfiguration'), invoke('work', 'backlogs'),
  invoke('work', 'teamfieldvalues'), invoke('wit', 'workitemtypestates'), invoke('wit', 'comments'), invoke('wit', 'tags'),
  invoke('wit', 'workitemtypes'), invoke('wit', 'workitemrelationtypes'), invoke('wit', 'workitemsbatch', 'POST'),
  invoke('wit', 'wiql', 'POST'), invoke('git', 'items'), invoke('git', 'commits'), invoke('git', 'trees'),
  invoke('git', 'blobs'), invoke('git', 'pullRequests'), invoke('git', 'pullRequestStatuses'),
  invoke('git', 'pullRequestReviewers'), invoke('policy', 'evaluations'),
  ['rest', '--method', 'get', '--url', 'https://dev.azure.com/contoso/_apis/permissions/2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87/4?tokens=repoV2/a/b'],
  ['rest', '--method', 'get', '--url', 'https://dev.azure.com/contoso/_apis/securitynamespaces?api-version=7.1'],
  ['rest', '--method', 'get', '--url', 'https://dev.azure.com/contoso/project/_apis/wit/classificationnodes/areas?api-version=7.1'],
])('allows a known Azure read: %j', (...args) => {
  expect(() => assertAzureCommandAllowed(args, readonly)).not.toThrow();
});

test('issue option identity reads stay available in read-only sessions', () => {
  expect(() => assertAzureCommandAllowed(['devops', 'team', 'list-member', '--team', 'Team', '--project', 'Project', '--org', 'https://dev.azure.com/example'], readonly)).not.toThrow();
});

const writes = [
  ['boards', 'work-item', 'create'], ['boards', 'work-item', 'update'], ['boards', 'work-item', 'delete'],
  ['repos', 'pr', 'create'], ['repos', 'pr', 'update'], ['repos', 'pr', 'work-item', 'add'],
  ['repos', 'ref', 'create'], ['repos', 'ref', 'delete'], invoke('git', 'pushes', 'POST'),
  invoke('git', 'pullRequestThreads', 'POST'), invoke('wit', 'workitems', 'POST'), invoke('wit', 'comments', 'POST'),
  invoke('wit', 'comments', 'PATCH'), invoke('wit', 'tags', 'PATCH'),
  ['rest', '--method', 'patch', '--url', 'https://dev.azure.com/contoso/project/_apis/wit/workitems/1'],
  ['rest', '--method', 'delete', '--url', 'https://dev.azure.com/contoso/project/_apis/wit/workitems/1'],
  invoke('wit', 'unknown'), invoke('git', 'pushes'),
  [...invoke('wit', 'tags', 'GET'), '--http-method=PATCH'], [...invoke('wit', 'tags'), '-m', 'PATCH'],
  [...invoke('wit', 'comments'), '--http-metho', 'POST'],
  [...invoke('wit', 'comments', 'GET'), '--http-metho=POST'],
  ['rest', '--method', 'GET', '--url', 'https://dev.azure.com/contoso/_apis/securitynamespaces', '--metho', 'POST'],
  [...invoke('wit', 'tags'), '--in-file', 'body.json'],
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
