// Node entry: each tracker's adapter for the label operations in tracker-capabilities.ts, through its CLI's local login.
import { assertAzureWriteAllowed } from './azure-safety.ts';
import { decodePart, isRecord, onAzure } from './index.ts';
import { API_VERSION, providerCommand, withFile, workItemPatch } from './provider-command.ts';
import { trackerCapabilities, type TrackerLabel, type TrackerLabels } from './tracker-capabilities.ts';

/** Runs each CLI; tests stand in for them. */
interface LabelCommands {
  gh(args: string[], input?: string): Promise<string>;
  az(args: string[]): Promise<string>;
}

const COMMANDS: LabelCommands = { gh: (args, input) => providerCommand('gh', args, input), az: (args) => providerCommand('az', args) };

/** GitHub's own default for a label made without a colour. */
const DEFAULT_COLOR = 'ededed';

function githubLabels(repo: string, gh: LabelCommands['gh']): TrackerLabels {
  const api = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const answer = await gh(['api', '--method', method, path, ...body === undefined ? [] : ['--input', '-']], body === undefined ? undefined : JSON.stringify(body));
    return answer.trim() ? JSON.parse(answer) as unknown : undefined;
  };
  const labelOf = (raw: unknown): TrackerLabel => {
    if (!isRecord(raw) || typeof raw.name !== 'string') throw new Error('GitHub returned an unreadable label.');
    return { name: raw.name, ...typeof raw.color === 'string' && { color: raw.color }, ...typeof raw.description === 'string' && { description: raw.description } };
  };
  const labels = `repos/${repo}/labels`;
  return {
    list: async () => {
      const pages = JSON.parse(await gh(['api', '--method', 'GET', `${labels}?per_page=100`, '--paginate', '--slurp'])) as unknown;
      if (!Array.isArray(pages)) throw new Error('GitHub returned an unreadable list of labels.');
      return pages.flat().map(labelOf);
    },
    create: async ({ color = DEFAULT_COLOR, ...label }) => labelOf(await api('POST', labels, { ...label, color })),
    update: async (name, { name: newName, ...change }) => labelOf(await api('PATCH', `${labels}/${encodeURIComponent(name)}`, { ...newName !== undefined && { new_name: newName }, ...change })),
    delete: async (name) => { await api('DELETE', `${labels}/${encodeURIComponent(name)}`); },
    addToTicket: async (ticket, names) => { if (names.length) await api('POST', `repos/${repo}/issues/${ticket}/labels`, { labels: names }); },
    removeFromTicket: async (ticket, names) => {
      for (const name of names) await api('DELETE', `repos/${repo}/issues/${ticket}/labels/${encodeURIComponent(name)}`);
    },
  };
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function azureLabels(repo: string, az: LabelCommands['az']): TrackerLabels {
  const [organization, encoded] = repo.split('/') as [string, string];
  const project = decodePart(encoded);
  const invoke = (resource: string, method: string, route: string[] = [], file?: string) => ['devops', 'invoke', '--area', 'wit', '--resource', resource,
    '--route-parameters', `project=${project}`, ...route, '--http-method', method, ...file ? ['--in-file', file] : [],
    '--api-version', API_VERSION, '--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];

  /**
   * System.Tags is one field, so a change writes the full list its own read just returned, and the /rev test fails the write
   * if someone changed the work item since, which keeps every other tag.
   */
  const changeTags = async (ticket: number, change: (tags: string[]) => string[]) => {
    assertAzureWriteAllowed();
    const { value: [item] } = await withFile({ ids: [ticket], fields: ['System.Tags'], errorPolicy: 'Fail' }, async (file) =>
      JSON.parse(await az(invoke('workitemsbatch', 'POST', [], file))) as { value: { rev: number; fields: Record<string, unknown> }[] });
    if (!item) throw new Error(`Work item ${ticket} does not exist in ${project}, or you have no right to read it.`);
    const tagsField = item.fields['System.Tags'];
    const tags = typeof tagsField === 'string' ? tagsField.split(';').map((tag) => tag.trim()).filter(Boolean) : [];
    const changed = change(tags);
    if (changed.length === tags.length) return;
    await withFile([{ op: 'test', path: '/rev', value: item.rev }, { op: changed.length > tags.length ? 'add' : 'replace', path: '/fields/System.Tags', value: changed.join('; ') }],
      (file) => az(workItemPatch(organization, project, ticket, file)));
  };

  return {
    list: async () => {
      const { value } = JSON.parse(await az(invoke('tags', 'GET'))) as { value: { name: string }[] };
      return value.map(({ name }) => ({ name }));
    },
    create: async () => {
      assertAzureWriteAllowed();
      throw new Error(trackerCapabilities(repo).createUnavailable!);
    },
    update: async (name, { name: newName, ...rest }) => {
      assertAzureWriteAllowed();
      if (Object.keys(rest).length) throw new Error('Azure DevOps tags have no colour or description.');
      if (newName === undefined) return { name };
      const answer = await withFile({ name: newName }, (file) => az(invoke('tags', 'PATCH', [`tagIdOrName=${name}`], file)));
      return { name: (JSON.parse(answer) as { name: string }).name };
    },
    delete: async (name) => {
      assertAzureWriteAllowed();
      await az(invoke('tags', 'DELETE', [`tagIdOrName=${name}`]));
    },
    addToTicket: (ticket, names) => changeTags(ticket, (tags) => [...tags, ...names.filter((name, at) =>
      !tags.some((tag) => sameTag(tag, name)) && names.findIndex((other) => sameTag(other, name)) === at)]),
    removeFromTicket: (ticket, names) => changeTags(ticket, (tags) => tags.filter((tag) => !names.some((name) => sameTag(tag, name)))),
  };
}

/** The label operations of the tracker holding `repo`, a repository key. */
export const trackerLabels = (repo: string, commands: LabelCommands = COMMANDS): TrackerLabels =>
  onAzure(repo) ? azureLabels(repo, commands.az) : githubLabels(repo, commands.gh);
