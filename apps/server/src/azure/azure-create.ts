// Add item on Azure DevOps: creates a work item of the team's requirement backlog level's default type, as slice.sh
// creates a Task, in one call. Its kind, labels and status-list are its tags, and its description is markdown.

import { statusLabel } from '@lar-factory/shared';
import type { CreationProgress, CreationResult, Item, ItemDraft } from '@lar-factory/shared';
import { ReadProblem } from '../items/item-source.ts';
import type { AzureCalls, RawWorkItem } from './azure-items.ts';
import { withFile, writeFailure } from './azure-writes.ts';

/** The REST API version of the create call, the first that takes a markdown description. */
const CREATE_API_VERSION = '7.2-preview.3';
const WHAT = 'Could not create the work item.';
const UNCERTAIN = 'Work item creation could not be confirmed. Check the work items in Azure DevOps before starting a new item; this submission will not create another work item.';

/** An az failure that shows Azure DevOps refused the call, so it created nothing: a missing or logged-out az, or a TF or VS error code. */
const refused = (err: unknown) => err instanceof ReadProblem || /\b(?:TF|VS)\d{5,6}\b/.test(err instanceof Error ? err.message : String(err));

/**
 * The create of an Azure item source on `project`: `type` reads the type to create, and `item` is the board's item for
 * the work item created. A retry resumes from `progress`, so it never creates a second work item.
 */
export function azureCreate(project: string, invoke: AzureCalls['invoke'], type: () => Promise<string>, item: (raw: RawWorkItem) => Item) {
  return async (draft: ItemDraft, progress: CreationProgress): Promise<CreationResult> => {
    if (progress.creationUncertain) return { item: null, issueUrl: null, uncertain: true, error: UNCERTAIN };
    if (progress.item) return { item: progress.item, issueUrl: progress.item.url, error: null };
    try {
      const ops = [
        { op: 'add', path: '/fields/System.Title', value: draft.title },
        { op: 'add', path: '/fields/System.Description', value: draft.description },
        { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
        { op: 'add', path: '/fields/System.Tags', value: [draft.kind, ...draft.labels, statusLabel('List')].join('; ') },
      ];
      const created = `type=${await type()}`;
      const raw = await withFile(ops, (file) => {
        // az can time out after Azure DevOps created the work item. Never blindly create it again.
        progress.creationUncertain = true;
        return invoke<RawWorkItem>('wit', 'workitems', [created],
          ['--http-method', 'POST', '--media-type', 'application/json-patch+json', '--in-file', file], CREATE_API_VERSION);
      });
      progress.creationUncertain = false;
      progress.item = item(raw);
      return { item: progress.item, issueUrl: progress.item.url, error: null };
    } catch (err) {
      if (refused(err)) progress.creationUncertain = false;
      if (progress.creationUncertain) return { item: null, issueUrl: null, uncertain: true, error: UNCERTAIN };
      return { item: null, issueUrl: null, error: writeFailure(WHAT, project, err) };
    }
  };
}
