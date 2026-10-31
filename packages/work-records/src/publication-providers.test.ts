import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import type { PublicationTicket } from '@lar-factory/shared';
import { publicationProvider } from './publication-providers.ts';

const ticket: PublicationTicket = { workId: 'private', settingsSnapshot: 'settings', destination: { provider: 'github', repository: 'team/app' },
  vocabulary: { build: { type: 'Task', labels: ['Search'] } }, typeResolution: { candidates: ['Task'], selected: 'Task' }, title: 'Find searches', body: 'Find saved searches by name.' };
it('creates GitHub tickets with only approved title, body, mapped type and labels', async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const provider = publicationProvider({ github: async (args, input) => { calls.push({ args, input }); return JSON.stringify({ number: 12, html_url: 'https://github.com/team/app/issues/12' }); }, azure: async () => { throw new Error('Unexpected Azure call.'); } });
  expect(await provider.create(ticket)).toEqual({ ticket: 'team/app#12', url: 'https://github.com/team/app/issues/12' });
  expect(calls).toEqual([{ args: ['api', '--method', 'POST', 'repos/team/app/issues', '--input', '-'], input: '{"title":"Find searches","body":"Find saved searches by name.","labels":["Search"],"type":"Task"}' }]);
});

it('creates Azure Markdown through invoke with only approved fields, then guards native links with rev through rest', async () => {
  const azureTicket: PublicationTicket = { ...ticket, destination: { provider: 'azure', repository: 'contoso/My%20Project/app' } };
  const calls: { args: string[]; body?: unknown }[] = [];
  const provider = publicationProvider({ github: async () => { throw new Error('Unexpected GitHub call.'); }, azure: async (args) => {
    const file = args.includes('--in-file') ? args[args.indexOf('--in-file') + 1] : args.includes('--body') ? args[args.indexOf('--body') + 1]?.slice(1) : undefined;
    const body = file ? JSON.parse(readFileSync(file, 'utf8')) as unknown : undefined;
    calls.push({ args, body });
    if (args.includes('workitemrelationtypes')) return JSON.stringify({ value: [{ referenceName: 'System.LinkTypes.Hierarchy-Reverse', attributes: { enabled: true } }] });
    if (args.includes('workitemsbatch')) return JSON.stringify({ value: [{ id: 12, rev: 3 }] });
    return JSON.stringify({ id: 12 });
  } });
  const made = await provider.create(azureTicket);
  expect(made).toEqual({ ticket: 'contoso/My%20Project/app#12', url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/12' });
  expect(calls[0]?.body).toEqual([
    { op: 'add', path: '/fields/System.Title', value: 'Find searches' }, { op: 'add', path: '/fields/System.Description', value: 'Find saved searches by name.' },
    { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' }, { op: 'add', path: '/fields/System.Tags', value: 'Search' },
  ]);
  expect(calls[0]?.args).toEqual(['devops', 'invoke', '--area', 'wit', '--resource', 'workitems', '--route-parameters', 'project=My Project', 'type=Task', '--http-method', 'POST', '--in-file', expect.any(String), '--media-type', 'application/json-patch+json', '--api-version', '7.2-preview', '--org', 'https://dev.azure.com/contoso', '--detect', 'false', '--output', 'json']);
  expect(await provider.capability(azureTicket, azureTicket, 'child')).toEqual({ available: true });
  await provider.relate(azureTicket, made, azureTicket, { ticket: 'contoso/My%20Project/app#10', url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/10' }, 'child');
  expect(calls.at(-1)?.args).toEqual(['rest', '--method', 'patch', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--url', 'https://dev.azure.com/contoso/My%20Project/_apis/wit/workitems/12?api-version=7.1', '--headers', 'Content-Type=application/json-patch+json', '--body', expect.stringMatching(/^@/), '--output', 'json']);
  expect(calls.at(-1)?.body).toEqual([{ op: 'test', path: '/rev', value: 3 }, { op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/contoso/My%20Project/_apis/wit/workItems/10' } }]);
  expect(JSON.stringify(calls.map((c) => c.body))).not.toMatch(/Assignee|AssignedTo|Priority|Iteration|System.State|repo-|status-|workId|private/);
});

it('searches and inspects Azure creation evidence without a public identity marker', async () => {
  const azureTicket: PublicationTicket = { ...ticket, destination: { provider: 'azure', repository: 'contoso/project/app' } };
  const calls: { args: string[]; body?: unknown }[] = [];
  const provider = publicationProvider({ github: async () => { throw new Error('Unexpected GitHub call.'); }, azure: async (args) => {
    const file = args.includes('--in-file') ? args[args.indexOf('--in-file') + 1] : undefined;
    calls.push({ args, body: file ? JSON.parse(readFileSync(file, 'utf8')) : undefined });
    if (args.includes('wiql')) return JSON.stringify({ workItems: [{ id: 12 }] });
    return JSON.stringify({ value: [{ id: 12, fields: { 'System.Title': ticket.title, 'System.Description': ticket.body, 'System.WorkItemType': 'Task', 'System.Tags': 'Search' }, multilineFieldsFormat: { 'System.Description': 'Markdown' } }] });
  } });
  const matches = await provider.search(azureTicket, '2026-10-31T10:00:00.000Z');
  expect(await provider.inspect(azureTicket, matches[0]!)).toEqual({ ticket: 'contoso/project/app#12', url: 'https://dev.azure.com/contoso/project/_workitems/edit/12', title: ticket.title, body: ticket.body, type: 'Task', labels: ['Search'] });
  expect(calls[0]?.body).toEqual({ query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'project' AND [System.Title] = 'Find searches' AND [System.CreatedDate] >= '2026-10-31T10:00:00.000Z' ORDER BY [System.CreatedDate] DESC" });
  expect(calls[1]?.args).toContain('7.2-preview');
  expect(JSON.stringify(calls.map((c) => c.body))).not.toMatch(/workId|private|factory/);
});

it('appends to Azure raw HTML with a revision test and preserves colours, merged cells and format', async () => {
  const azureTicket: PublicationTicket = { ...ticket, destination: { provider: 'azure', repository: 'contoso/project/app' } };
  const target = { ticket: 'contoso/project/app#12', url: 'https://dev.azure.com/contoso/project/_workitems/edit/12' };
  const html = '<table><tr><td colspan="2" style="color:#ff0000">Author &amp; team</td></tr></table>';
  const patches: unknown[] = []; let stored = html;
  const provider = publicationProvider({ github: async () => { throw new Error('Unexpected GitHub call.'); }, azure: async (args) => {
    if (args.includes('workitemsbatch')) return JSON.stringify({ value: [{ id: 12, rev: 3, fields: { 'System.Description': stored }, multilineFieldsFormat: { 'System.Description': 'HTML' } }] });
    const patch = JSON.parse(readFileSync(args[args.indexOf('--body') + 1]!.slice(1), 'utf8'));
    patches.push(patch); stored = patch[1].value;
    return '{}';
  } });
  const expected = await provider.readBody(azureTicket, target);
  expect(expected).toMatchObject({ body: html, format: 'html', revision: 3, assigned: false, linkedPullRequest: false });
  await provider.writeBody(azureTicket, target, { kind: 'append', operationId: 'append', ticketWorkId: 'private', dependsOn: [],
    content: '<h2>Refined description</h2><pre>New content</pre>', location: { kind: 'body', start: html.length, end: html.length }, expectedText: '', expected });
  expect(patches).toEqual([[{ op: 'test', path: '/rev', value: 3 }, { op: 'add', path: '/fields/System.Description', value: html + '<h2>Refined description</h2><pre>New content</pre>' }]]);
});
