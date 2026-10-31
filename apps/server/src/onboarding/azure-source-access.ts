// Check the selected team's read access without loading its work or linked PRs.
import { decodePart, isRecord } from '@lar-factory/shared';
import { API_VERSION, az, orgFlags, problemOf, withFile, type Az } from '../azure/azure-items.ts';

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** At most one work item is read. WIQL and workitemsbatch POSTs are read-only Azure APIs. */
export async function checkAzureSourceAccess(repo: string, team: string, run: Az = az): Promise<void> {
  const [organization, encodedProject] = repo.split('/') as [string, string, string];
  const route = [`project=${decodePart(encodedProject)}`, `team=${team}`];
  const invoke = async (area: string, resource: string, more: string[] = []): Promise<unknown> => JSON.parse(await run([
    'devops', 'invoke', '--area', area, '--resource', resource, '--route-parameters', ...route,
    ...more, '--api-version', API_VERSION, ...orgFlags(organization), '--output', 'json',
  ]));
  try {
    const [backlog, fields] = await Promise.all([
      invoke('work', 'backlogconfiguration'), invoke('work', 'teamfieldvalues'),
    ]);
    if (!isRecord(backlog) || !isRecord(backlog.requirementBacklog) || !Array.isArray(backlog.requirementBacklog.workItemTypes)
      || !isRecord(fields) || !isRecord(fields.field) || typeof fields.field.referenceName !== 'string'
      || !/^[A-Za-z][\w.]*$/.test(fields.field.referenceName) || !Array.isArray(fields.values)
      || backlog.requirementBacklog.workItemTypes.length > 100 || fields.values.length > 200) {
      throw Error("Azure did not return the selected team's backlog and area settings.");
    }
    const referenceName = fields.field.referenceName;
    const types = backlog.requirementBacklog.workItemTypes.map((type) => {
      if (!isRecord(type) || typeof type.name !== 'string' || !type.name.trim()) throw Error('Azure returned an invalid backlog work item type.');
      return quoted(type.name);
    });
    const areas = fields.values.map((area) => {
      if (!isRecord(area) || typeof area.value !== 'string' || typeof area.includeChildren !== 'boolean') throw Error('Azure returned an invalid team area.');
      return `[${referenceName}] ${area.includeChildren ? 'UNDER' : '='} ${quoted(area.value)}`;
    });
    if (!types.length || !areas.length) throw Error('The selected team needs a requirement backlog and at least one area.');
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN (${types.join(', ')}) AND (${areas.join(' OR ')})`;
    if (query.length > 32_000) throw Error("The selected team's area settings are too large for an access check.");
    const listed = await withFile({ query }, (file) => invoke('wit', 'wiql', ['--http-method', 'POST', '--in-file', file, '--query-parameters', '$top=1']));
    if (!isRecord(listed) || !Array.isArray(listed.workItems) || listed.workItems.length > 1) throw Error('Azure did not return a bounded issue-list check.');
    const sample = listed.workItems[0];
    if (sample === undefined) return;
    if (!isRecord(sample) || !Number.isSafeInteger(sample.id) || Number(sample.id) <= 0) throw Error('Azure returned an invalid sample work item.');
    const read = await withFile({ ids: [sample.id], fields: ['System.Id'], errorPolicy: 'Fail' },
      (file) => invoke('wit', 'workitemsbatch', ['--http-method', 'POST', '--in-file', file]));
    if (!isRecord(read) || !Array.isArray(read.value) || read.value.length !== 1 || !isRecord(read.value[0]) || read.value[0].id !== sample.id) {
      throw Error("Azure did not allow reading the selected team's sample work item.");
    }
  } catch (error) { throw problemOf(error); }
}
