import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import { assertAzureCommandAllowed } from '@lar-factory/shared/azure-safety';
import { checkAzureSourceAccess } from './azure-source-access.ts';

function source({ ids = [7], unreadable = false, denied = '', field = 'System.AreaPath' } = {}) {
  const calls: string[][] = [];
  const bodies: Record<string, Record<string, unknown>> = {};
  const run = async (args: string[]) => {
    assertAzureCommandAllowed(args, { LAR_FACTORY_AZURE_READ_ONLY: '1' });
    calls.push(args);
    const resource = args[args.indexOf('--resource') + 1]!;
    if (resource === denied) throw Error('Read work items denied');
    if (args.includes('--in-file')) bodies[resource] = JSON.parse(readFileSync(args[args.indexOf('--in-file') + 1]!, 'utf8'));
    if (resource === 'backlogconfiguration') return JSON.stringify({ requirementBacklog: { workItemTypes: [{ name: "User's Story" }] } });
    if (resource === 'teamfieldvalues') return JSON.stringify({ field: { referenceName: field }, values: [
      { value: "Project\\O'Brien", includeChildren: true }, { value: 'Project\\Exact', includeChildren: false },
    ] });
    if (resource === 'wiql') return JSON.stringify({ workItems: ids.map(id => ({ id })) });
    if (resource === 'workitemsbatch') return JSON.stringify({ value: unreadable ? [] : [{ id: ids[0] }] });
    throw Error(`Unexpected probe resource ${resource}`);
  };
  return { calls, bodies, run };
}

test('Azure access checks the selected team and reads only one item, without loading its description, relations or PRs', async () => {
  const fake = source();
  await checkAzureSourceAccess('sample/Team%20Project/app', 'App Team', fake.run);
  expect(fake.calls).toHaveLength(4);
  expect(fake.calls.every(args => args.includes('project=Team Project') && args.includes('team=App Team'))).toBe(true);
  expect(fake.calls.map(args => args[args.indexOf('--resource') + 1])).toEqual(['backlogconfiguration', 'teamfieldvalues', 'wiql', 'workitemsbatch']);
  expect(fake.calls[2]).toContain('$top=1');
  expect(fake.bodies.wiql!.query).toContain("[System.WorkItemType] IN ('User''s Story')");
  expect(fake.bodies.wiql!.query).toContain("[System.AreaPath] UNDER 'Project\\O''Brien'");
  expect(fake.bodies.wiql!.query).toContain("[System.AreaPath] = 'Project\\Exact'");
  expect(fake.bodies.workitemsbatch).toEqual({ ids: [7], fields: ['System.Id'], errorPolicy: 'Fail' });
});

test('an empty team proves query access without a work-item read', async () => {
  const fake = source({ ids: [] });
  await checkAzureSourceAccess('sample/Project/app', 'App Team', fake.run);
  expect(fake.calls).toHaveLength(3);
});

test.each(['backlogconfiguration', 'teamfieldvalues', 'wiql', 'workitemsbatch'])('a refused %s read stops access checking', async (denied) => {
  const fake = source({ denied });
  await expect(checkAzureSourceAccess('sample/Project/app', 'App Team', fake.run)).rejects.toThrow('Read work items denied');
  expect(fake.calls.some(args => args[args.indexOf('--http-method') + 1] === 'PATCH')).toBe(false);
});

test('unbounded or unreadable samples and invalid field names fail without a broad fallback', async () => {
  for (const options of [{ ids: [7, 8] }, { unreadable: true }, { field: "System.AreaPath] = 'x' OR [System.Id" }]) {
    const fake = source(options);
    await expect(checkAzureSourceAccess('sample/Project/app', 'App Team', fake.run)).rejects.toThrow();
    expect(fake.calls.filter(args => args.includes('workitemsbatch')).length).toBeLessThanOrEqual(1);
  }
});
