// Writes to Azure DevOps work items through az, as status.sh writes them. A move swaps the work item's status-<name> tag
// in System.Tags and moves State only across state categories, a label is a tag, and Abandon moves State to the type's
// Removed-category state. Each write is one JSON patch that fails if the work item changed since the board read it.

import { carriesTwoStatuses, keepOneText, labelStatuses, statusLabel } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import { DONE_REFUSED, ReadProblem, type ItemSource } from '../items/item-source.ts';
import { field, isRepoTag, tagsOf, withFile, type AzureCalls, type RawWorkItem } from './azure-items.ts';

/** The most tags Azure DevOps lets one work item hold. */
const TAG_LIMIT = 100;

/** Why an open item carrying more than one status tag can't move, or null when it carries at most one. */
const twoStatuses = (item: { statuses: readonly Status[]; state: 'open' | 'closed' }): string | null =>
  (carriesTwoStatuses(item) ? keepOneText(item.statuses) : null);

/** `what` failed in `project`, with the failure's message and fix. */
export function writeFailure(what: string, project: string, err: unknown): string {
  if (err instanceof ReadProblem) return `${what} ${err.message}${err.fix ? ` Run ${err.fix}, then try again.` : ''}`;
  const text = err instanceof Error ? err.message : String(err);
  if (/TF401289|permissions? to create tags/i.test(text)) {
    return `${what} You have no right to create tags in ${project}. Ask a project administrator to allow you Create tag definition, then try again.`;
  }
  return `${what} ${text}`;
}

type Operation = { op: 'test' | 'replace'; path: string; value: unknown };

/**
 * The writes of an Azure item source on `project`, through its batch `workItems` read, its `patchWorkItem` of a work item
 * with the JSON patch in a file, and its kept `statesOf`.
 */
export function azureWrites(project: string, workItems: AzureCalls['workItems'], patchWorkItem: (id: number, file: string) => Promise<unknown>,
  typeStates: (type: string) => Promise<{ value: { name: string; category: string }[] }>):
  Pick<ItemSource, 'setStatus' | 'statusRefusal' | 'addLabel' | 'setParentStatus' | 'abandon'> {
  const read = async (id: number) => {
    const [raw] = await workItems([id]);
    if (!raw) throw new Error(`Work item ${id} does not exist in ${project}, or you have no right to read it.`);
    return raw as RawWorkItem & { rev: number };
  };
  const full = (id: number) => new Error(`Work item ${id} has ${TAG_LIMIT} tags, Azure's limit. Remove a tag in Azure DevOps, then try again.`);

  /** The states of the work item's type, each with its category, in the type's order. */
  const statesOf = async (raw: RawWorkItem) => (await typeStates(field(raw, 'System.WorkItemType'))).value;

  /** Writes the operations to the work item read at `raw`, failing if it changed since. */
  const patch = (raw: RawWorkItem & { rev: number }, ops: Operation[]) =>
    withFile([{ op: 'test', path: '/rev', value: raw.rev }, ...ops], (file) =>
      patchWorkItem(raw.id, file));

  /** Runs a write, returning null, the refusal it returns, or `what` failed with the failure's message and fix. */
  async function attempt(what: string, write: () => Promise<string | void>): Promise<string | null> {
    try {
      return (await write()) ?? null;
    } catch (err) {
      return writeFailure(what, project, err);
    }
  }

  /**
   * Swaps the work item's status tag for the status's, keeping every other tag. Entering a status after Queued moves a
   * Proposed-category item to the first InProgress-category state; List or Queued moves a later one back to the first
   * Proposed-category state.
   */
  async function move(id: number, status: Status): Promise<string | null> {
    if (status === 'Done') return DONE_REFUSED;
    const tag = statusLabel(status);
    return attempt(`Could not set ${status}.`, async () => {
      const raw = await read(id);
      const tags = tagsOf(raw);
      const carried = labelStatuses(tags);
      const refusal = twoStatuses({ statuses: carried, state: 'open' });
      if (refusal) return refusal;
      const current = carried[0] && statusLabel(carried[0] as Exclude<Status, 'Done'>);
      if (!current && tags.length >= TAG_LIMIT) throw full(id);
      const states = await statesOf(raw);
      const category = states.find((s) => s.name === field(raw, 'System.State'))?.category ?? '';
      const target = status === 'List' || status === 'Queued'
        ? (['InProgress', 'Resolved', 'Completed'].includes(category) ? 'Proposed' : null)
        : (category === 'Proposed' ? 'InProgress' : null);
      const state = target && states.find((s) => s.category === target)?.name;
      if (target && !state) throw new Error(`${field(raw, 'System.WorkItemType')} in ${project} has no ${target}-category state to move work item ${id} to.`);
      await patch(raw, [
        { op: 'replace', path: '/fields/System.Tags', value: [...tags.filter((t) => t !== current), tag].join('; ') },
        ...state ? [{ op: 'replace' as const, path: '/fields/System.State', value: state }] : [],
      ]);
    });
  }

  return {
    setStatus: (item, status) => move(item.number!, status),
    statusRefusal: (item) => ('statuses' in item ? twoStatuses(item) : null),
    setParentStatus: (parent, status) => move(parent.number, status),
    addLabel(item, label) {
      const what = `Could not add the ${label} tag.`;
      if (/[,;]/.test(label)) return Promise.resolve(`${what} An Azure DevOps tag cannot contain a comma or a semicolon. Name the label without them.`);
      return attempt(what, async () => {
        const raw = await read(item.number!);
        const tags = tagsOf(raw);
        if (tags.includes(label)) return;
        // A work item is for one repository: its own tag in another case is already there, another's refuses this one.
        const tagged = isRepoTag(label) && tags.find(isRepoTag);
        if (tagged && tagged.toLowerCase() === label.toLowerCase()) return;
        if (tagged) return `${what} Work item ${raw.id} is already tagged for ${tagged.slice('repo-'.length)}. Remove ${tagged} in Azure DevOps to take it for another repository.`;
        if (tags.length >= TAG_LIMIT) throw full(raw.id);
        await patch(raw, [{ op: 'replace', path: '/fields/System.Tags', value: [...tags, label].join('; ') }]);
      });
    },
    abandon: (item) => attempt(`Could not abandon work item ${item.number}.`, async () => {
      const raw = await read(item.number!);
      const state = (await statesOf(raw)).find((s) => s.category === 'Removed')?.name;
      if (!state) throw new Error(`${field(raw, 'System.WorkItemType')} in ${project} has no Removed-category state. Close or delete it in Azure DevOps.`);
      await patch(raw, [{ op: 'replace', path: '/fields/System.State', value: state }]);
    }),
  };
}
