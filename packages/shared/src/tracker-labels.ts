// Node entry: each tracker's adapter for the label operations in tracker-capabilities.ts, through its CLI's local login.
import { assertAzureWriteAllowed } from './azure-safety.ts';
import { decodePart, isRecord, onAzure, readTrackerStructure, sameLabel, stripTrackerStructure, writeTrackerStructure } from './index.ts';
import { API_VERSION, MARKDOWN_API_VERSION, providerCommand, withFile, workItemPatch } from './provider-command.ts';
import { trackerCapabilities, type TicketKinds, type TrackerLabel, type TrackerLabels } from './tracker-capabilities.ts';

/** Runs each CLI; tests stand in for them. */
interface LabelCommands {
  gh(args: string[], input?: string): Promise<string>;
  az(args: string[]): Promise<string>;
}

const COMMANDS: LabelCommands = { gh: (args, input) => providerCommand('gh', args, input), az: (args) => providerCommand('az', args) };

/** GitHub's own default for a label made without a colour. */
const DEFAULT_COLOR = 'ededed';

/** `name` as one part of a URL's path. Encoding leaves a dot alone, and a part of only dots would climb out of the label's route. */
function labelPathPart(name: string): string {
  if (/^\.+$/.test(name)) throw new Error(`The factory can't address a label named ${name}.`);
  return encodeURIComponent(name);
}

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
    update: async (name, { name: newName, ...change }) => labelOf(await api('PATCH', `${labels}/${labelPathPart(name)}`, { ...newName !== undefined && { new_name: newName }, ...change })),
    delete: async (name) => { await api('DELETE', `${labels}/${labelPathPart(name)}`); },
    addToTicket: async (ticket, names) => { if (names.length) await api('POST', `repos/${repo}/issues/${ticket}/labels`, { labels: names }); },
    removeFromTicket: async (ticket, names) => {
      for (const name of names) await api('DELETE', `repos/${repo}/issues/${ticket}/labels/${labelPathPart(name)}`);
    },
  };
}

function githubKinds(repo: string, gh: LabelCommands['gh']): TicketKinds {
  const issue = (ticket: number) => `repos/${repo}/issues/${ticket}`;
  return {
    read: async (ticket) => {
      const raw = JSON.parse(await gh(['api', '--method', 'GET', issue(ticket)])) as { labels?: { name: string }[]; type?: { name: string } | null };
      return { labels: (raw.labels ?? []).map(({ name }) => name), type: raw.type?.name ?? null };
    },
    setType: async (ticket, type) => { await gh(['api', '--method', 'PATCH', issue(ticket), '--input', '-'], JSON.stringify({ type })); },
    boardTypes: async () => null,
  };
}

/** The repository's organization and project, and the az arguments of a devops invoke in them. */
function azureProject(repo: string) {
  const [organization, encoded] = repo.split('/') as [string, string];
  const project = decodePart(encoded);
  const invoke = (resource: string, method: string, route: string[] = [], file?: string, { area = 'wit', version = API_VERSION } = {}) => ['devops', 'invoke', '--area', area, '--resource', resource,
    '--route-parameters', `project=${project}`, ...route, '--http-method', method, ...file ? ['--in-file', file] : [],
    '--api-version', version, '--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];
  return { organization, project, invoke };
}

function azureLabels(repo: string, az: LabelCommands['az']): TrackerLabels {
  const { organization, project, invoke } = azureProject(repo);

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
      const answer = await withFile({ name: newName }, (file) => az(invoke('tags', 'PATCH', [`tagIdOrName=${labelPathPart(name)}`], file)));
      return { name: (JSON.parse(answer) as { name: string }).name };
    },
    delete: async (name) => {
      assertAzureWriteAllowed();
      await az(invoke('tags', 'DELETE', [`tagIdOrName=${labelPathPart(name)}`]));
    },
    addToTicket: (ticket, names) => changeTags(ticket, (tags) => [...tags, ...names.filter((name, at) =>
      !tags.some((tag) => sameLabel(tag, name)) && names.findIndex((other) => sameLabel(other, name)) === at)]),
    removeFromTicket: (ticket, names) => changeTags(ticket, (tags) => tags.filter((tag) => !names.some((name) => sameLabel(tag, name)))),
  };
}

const DESCRIPTION = 'System.Description';
const REPRO_STEPS = 'Microsoft.VSTS.TCM.ReproSteps';
/** The field a type shows as its main text, as the Spec path chooses it. */
const mainField = (type: string) => (type.toLowerCase() === 'bug' ? REPRO_STEPS : DESCRIPTION);
const hasContent = (value: string) => Boolean(value.replace(/<[^>]*>|&nbsp;|&#160;/g, '').trim()) || /<(?:img|video|iframe)\b/i.test(value);

interface AzureText { fields: Record<string, unknown>; multilineFieldsFormat?: Record<string, string> }

/**
 * The patch that shows a work item's main text in the field its new type shows. The old field keeps its text, and so does the
 * new field's own differing text, after the moved text. Structure stays in the Description, the only field its reader reads. A
 * field can't go back from markdown, and HTML reads the same in one, so the new field is markdown if either field was.
 */
function moveMainText(item: AzureText, fromType: string, toType: string): { op: 'add'; path: string; value: string }[] {
  const [from, to] = [mainField(fromType), mainField(toType)];
  const text = (name: string) => (typeof item.fields[name] === 'string' ? item.fields[name] : '');
  const moved = stripTrackerStructure(text(from));
  const own = stripTrackerStructure(text(to));
  if (from === to || !hasContent(moved) || own.includes(moved)) return [];
  const markdown = [from, to].some((name) => item.multilineFieldsFormat?.[name] === 'Markdown');
  const merged = hasContent(own) ? `${moved}${markdown ? '\n\n---\n\n' : '<hr>'}${own}` : moved;
  const structure = readTrackerStructure(text(to));
  return [{ op: 'add', path: `/fields/${to}`, value: structure ? writeTrackerStructure(merged, structure) : merged },
    ...markdown ? [{ op: 'add' as const, path: `/multilineFieldsFormat/${to}`, value: 'Markdown' }] : []];
}

function azureKinds(repo: string, az: LabelCommands['az']): TicketKinds {
  const { organization, project, invoke } = azureProject(repo);
  /** The work item with what its type and text need, and each field's format, which only a 7.2 preview read returns. */
  const workItem = async (ticket: number, fields: string[]) => {
    const { value: [item] } = await withFile({ ids: [ticket], fields, errorPolicy: 'Fail' }, async (file) =>
      JSON.parse(await az(invoke('workitemsbatch', 'POST', [], file, { version: '7.2-preview' }))) as { value: (AzureText & { rev: number })[] });
    if (!item) throw new Error(`Work item ${ticket} does not exist in ${project}, or you have no right to read it.`);
    return item;
  };
  return {
    read: async (ticket) => {
      const { fields } = await workItem(ticket, ['System.Tags', 'System.WorkItemType']);
      const tags = fields['System.Tags'];
      return { labels: typeof tags === 'string' ? tags.split(';').map((tag) => tag.trim()).filter(Boolean) : [], type: String(fields['System.WorkItemType']) };
    },
    /** One patch, so the type and its text change together, and fails if someone changed the work item since its read. */
    setType: async (ticket, type) => {
      assertAzureWriteAllowed();
      const item = await workItem(ticket, ['System.WorkItemType', DESCRIPTION, REPRO_STEPS]);
      const ops = [{ op: 'test', path: '/rev', value: item.rev }, { op: 'add', path: '/fields/System.WorkItemType', value: type },
        ...moveMainText(item, String(item.fields['System.WorkItemType']), type)];
      await withFile(ops, (file) => az(workItemPatch(organization, project, ticket, file, MARKDOWN_API_VERSION)));
    },
    boardTypes: async (team) => {
      if (!team) return [];
      const { requirementBacklog } = JSON.parse(await az(invoke('backlogconfiguration', 'GET', [`team=${team}`], undefined, { area: 'work' }))) as { requirementBacklog: { workItemTypes: { name: string }[] } };
      return requirementBacklog.workItemTypes.map(({ name }) => name);
    },
  };
}

/** The type reads and writes of the tracker holding `repo`, a repository key. */
export const ticketKinds = (repo: string, commands: LabelCommands = COMMANDS): TicketKinds =>
  onAzure(repo) ? azureKinds(repo, commands.az) : githubKinds(repo, commands.gh);

/** The label operations of the tracker holding `repo`, a repository key. */
export const trackerLabels = (repo: string, commands: LabelCommands = COMMANDS): TrackerLabels =>
  onAzure(repo) ? azureLabels(repo, commands.az) : githubLabels(repo, commands.gh);
