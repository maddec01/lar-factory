// Add item on Azure DevOps: creates a work item of the team's requirement backlog level's default type, as slice.sh
// creates a Task, in one call. Its kind, labels and status-list are its tags, with its repository's repo- tag when
// Only for <repo> is ticked, and its description is markdown.

import { repoTag, statusLabel } from '@lar-factory/shared';
import type { CreationProgress, CreationResult, Item, ItemDraft } from '@lar-factory/shared';
import { ReadProblem } from '../items/item-source.ts';
import { withFile, type AzureCalls, type RawWorkItem } from './azure-items.ts';
import { writeFailure } from './azure-writes.ts';

/**
 * The REST API version of the create call, which az sends as 7.2-preview.3, the first that takes a markdown description:
 * az devops invoke reads the version as a number, so it can't pass the .3 itself.
 */
const CREATE_API_VERSION = '7.2-preview';
const WHAT = 'Could not create the work item.';
const UNCERTAIN = 'Work item creation could not be confirmed. Check the work items in Azure DevOps before starting a new item; this submission will not create another work item.';

/** An az failure that shows Azure DevOps refused the call, so it created nothing: a missing or logged-out az, or a TF or VS error code. */
const refused = (err: unknown) => err instanceof ReadProblem || /\b(?:TF|VS)\d{5,6}\b/.test(err instanceof Error ? err.message : String(err));

/**
 * The create of an Azure item source on `project`: `type` reads the type to create, and `item` is the board's item for
 * the work item the draft created. A retry resumes from `progress`, so it never creates a second work item.
 */
export function azureCreate(project: string, team: string, invoke: AzureCalls['invoke'], type: () => Promise<string>, item: (raw: RawWorkItem, draft: ItemDraft) => Item) {
  return async (draft: ItemDraft, progress: CreationProgress): Promise<CreationResult> => {
    if (progress.creationUncertain) return { item: null, issueUrl: null, uncertain: true, error: UNCERTAIN };
    if (progress.item) return { item: progress.item, issueUrl: progress.item.url, error: null };
    try {
      const [areas, settings] = await Promise.all([
        invoke<{ defaultValue?: string }>('work', 'teamfieldvalues', [`team=${team}`]),
        invoke<{ backlogIteration?: { path?: string } }>('work', 'teamsettings', [`team=${team}`]),
      ]);
      if (!areas.defaultValue || typeof settings.backlogIteration?.path !== 'string') throw new Error(`Could not read ${team}'s default area and backlog iteration. Check the team settings in Azure DevOps.`);
      // Team settings return a project-relative path: the root is empty, and a nested iteration starts with \\.
      const iteration = `${project}${settings.backlogIteration.path}`;
      const ops = [
        { op: 'add', path: '/fields/System.AreaPath', value: areas.defaultValue },
        { op: 'add', path: '/fields/System.IterationPath', value: iteration },
        { op: 'add', path: '/fields/System.Title', value: draft.title },
        { op: 'add', path: '/fields/System.Description', value: draft.description },
        { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
        { op: 'add', path: '/fields/System.Tags', value: [draft.kind, ...draft.labels, statusLabel('List'), ...draft.onlyFor ? [repoTag(draft.repo)] : []].join('; ') },
      ];
      const created = `type=${await type()}`;
      const raw = await withFile(ops, (file) => {
        // az can time out after Azure DevOps created the work item. Never blindly create it again.
        progress.creationUncertain = true;
        return invoke<RawWorkItem>('wit', 'workitems', [created],
          ['--http-method', 'POST', '--media-type', 'application/json-patch+json', '--in-file', file], CREATE_API_VERSION);
      });
      progress.creationUncertain = false;
      progress.item = item(raw, draft);
      return { item: progress.item, issueUrl: progress.item.url, error: null };
    } catch (err) {
      if (refused(err)) progress.creationUncertain = false;
      if (progress.creationUncertain) return { item: null, issueUrl: null, uncertain: true, error: UNCERTAIN };
      return { item: null, issueUrl: null, error: writeFailure(WHAT, project, err) };
    }
  };
}
