import { writeTrackerStructure } from '@lar-factory/shared';
// Writes to Azure DevOps work items through az: Abandon's confirmed close moves State to the type's Removed-category
// state, in one JSON patch that fails if the work item changed since the board read it.
// A description save writes the field the item dialog read, as markdown, failing if the work item changed since the dialog read it.

import { decodePart, onAzure } from '@lar-factory/shared';
import type { AzureBodyField, Item } from '@lar-factory/shared';
import type { Refused } from '../config/editable-repository.ts';
import { ReadProblem, type ItemSource } from '../items/item-source.ts';
import { az, field, problemOf, withFile, workItemPatch, type Az, type AzureCalls, type RawWorkItem } from './azure-items.ts';

/** `what` failed in `project`, with the failure's message and fix. */
function writeFailure(what: string, project: string, err: unknown): string {
  if (err instanceof ReadProblem) return `${what} ${err.message}${err.fix ? ` Run ${err.fix}, then try again.` : ''}`;
  return `${what} ${err instanceof Error ? err.message : String(err)}`;
}

type Operation = { op: 'test' | 'replace'; path: string; value: unknown };

/** The REST API version of a description save, the first that takes a markdown field; az rest sends it as is. */
const DESCRIPTION_API_VERSION = '7.2-preview.3';
/** A failed /rev test: Azure DevOps answers TF26071, or HTTP 412 Precondition Failed. */
const CHANGED = /TF26071|\b412\b|changed by someone else/i;
/** No right to edit work items in the work item's area: TF237111. */
const NO_EDIT_RIGHT = /TF237111|permissions? to save work items/i;

/**
 * Saves `body` as the markdown of the work item's `bodyField`, the field its details read, testing that its rev is still
 * `revision`. Returns null, or the refusal: 409 when someone changed it since, 403 without the right to edit it.
 * `run` stands in for az in tests.
 */
export async function saveAzureDescription(item: Item, { body, bodyField, revision }: { body: string; bodyField: AzureBodyField; revision: number },
  run: Az = az): Promise<Refused | null> {
  if (!item.repo || !onAzure(item.repo) || item.number === null) return { status: 404, error: 'That item is not an Azure DevOps work item.' };
  const [organization, encoded] = item.repo.split('/') as [string, string];
  const project = decodePart(encoded);
  const id = item.number;
  if (item.tracker && bodyField === 'System.Description') body = writeTrackerStructure(body,item.tracker);
  const ops: Operation[] = [
    { op: 'test', path: '/rev', value: revision },
    { op: 'replace', path: `/fields/${bodyField}`, value: body },
    { op: 'replace', path: `/multilineFieldsFormat/${bodyField}`, value: 'Markdown' },
  ];
  const what = 'Could not save the description.';
  try {
    await withFile(ops, (file) => run(workItemPatch(organization, project, id, file, DESCRIPTION_API_VERSION)).catch((err: unknown) => { throw problemOf(err); }));
    return null;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (CHANGED.test(text)) return { status: 409, error: `${what} Someone else changed work item ${id} since you opened it. Copy your text, close the item and open it again to edit the latest version.` };
    if (NO_EDIT_RIGHT.test(text)) return { status: 403, error: `${what} You have no right to edit work item ${id} in ${project}. Ask a project administrator for Edit work items in this node.` };
    return { status: 502, error: writeFailure(what, project, err) };
  }
}

/**
 * The Abandon close of an Azure item source on `project`, through its batch `workItems` read, its `patchWorkItem` of a
 * work item with the JSON patch in a file, and its kept `statesOf`.
 */
export function azureWrites(project: string, workItems: AzureCalls['workItems'], patchWorkItem: (id: number, file: string) => Promise<unknown>,
  typeStates: (type: string) => Promise<{ value: { name: string; category: string }[] }>):
  Pick<ItemSource, 'abandon'> {
  const read = async (id: number) => {
    const [raw] = await workItems([id]);
    if (!raw) throw new Error(`Work item ${id} does not exist in ${project}, or you have no right to read it.`);
    return raw as RawWorkItem & { rev: number };
  };

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

  return {
    abandon: (item) => attempt(`Could not abandon work item ${item.number}.`, async () => {
      const raw = await read(item.number!);
      const state = (await statesOf(raw)).find((s) => s.category === 'Removed')?.name;
      if (!state) throw new Error(`${field(raw, 'System.WorkItemType')} in ${project} has no Removed-category state. Close or delete it in Azure DevOps.`);
      await patch(raw, [{ op: 'replace', path: '/fields/System.State', value: state }]);
    }),
  };
}
