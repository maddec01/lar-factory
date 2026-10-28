// The GitHub side of onboarding's Labels step: reads a repository's labels, creates the workflow labels it lacks (and
// for a repository that reads its issues, its status labels), and renames old workflow labels to their new names. It
// reads the labels again before each change and works only from the shared label plan, so it changes no other label.
// It also creates a custom label the user types, or a reused .lar-factory.json's that the repository lacks, which is no
// workflow or status label; and it tells the finish and the PR whether a workflow label is still missing.
// On Azure DevOps the labels are the project's tags, read and renamed through az. It creates none: the board writes a
// tag the first time a work item needs it, so a missing one holds nothing back.

import { customLabelProblem, labelPlan, labelsToCreate, missingCustomLabels, onAzure, shownRepo, workflowLabelsMissing } from '@lar-factory/shared';
import { listTags, renameTag } from '../azure/azure-tags.ts';
import { isItemSource, isRepo } from '../config/repository-config.ts';
import { createLabel, listLabels, message, renameLabel } from '../github/github.ts';

type Run = (args: string[]) => Promise<string>;
type Answer = Promise<{ labels: string[] } | { status: number; error: string }>;

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** The repository's labels, or its project's tags on Azure DevOps, or why gh or az can't read them. */
async function read(repo: string, run?: Run): Answer {
  try { return { labels: await (onAzure(repo) ? listTags : listLabels)(repo, run) }; }
  catch (err) { return { status: 502, error: `Can't read ${shownRepo(repo)}'s ${onAzure(repo) ? 'tags' : 'labels'}: ${message(err)}` }; }
}

/** The refusal of a create on Azure DevOps, whose tags the board writes on the work items that need them. */
const NO_TAG_CREATE = { status: 400, error: 'Azure DevOps tags appear when first used. Continue without creating them.' };

/** Lists the body's repository's labels. */
export async function readRepositoryLabels(input: Record<string, unknown>, run?: Run): Answer {
  if (!isRepo(input.repo)) return { status: 400, error: 'Send the repository whose labels to read.' };
  return read(input.repo, run);
}

/**
 * Creates every label the step finds missing in the body's repository, read through its item source, except those
 * under an old name in `renaming`, which Rename moves instead, then each of the body's `custom` labels, a reused
 * .lar-factory.json's, that it lacks, with GitHub's colour, less any customLabelProblem refuses, which the step shows
 * on its row; answers with the labels it has then.
 */
export async function createRepositoryLabels(input: Record<string, unknown>, run?: Run): Answer {
  const { repo, itemSource, renaming, custom = [] } = input;
  if (!isRepo(repo) || !isItemSource(itemSource) || !strings(renaming) || !strings(custom)) {
    return { status: 400, error: 'Choose a repository and the labels to create or rename.' };
  }
  if (onAzure(repo)) return NO_TAG_CREATE;
  const before = await read(repo, run);
  if ('error' in before) return before;
  const labels = [...labelsToCreate(labelPlan(before.labels, itemSource.kind), renaming),
    ...missingCustomLabels(before.labels, custom.map((c) => c.trim())).map((name) => ({ name }))];
  for (const label of labels) {
    try { await createLabel(repo, label, run); }
    catch (err) { return { status: 502, error: `Couldn't create ${label.name} in ${repo}: ${message(err)}` }; }
  }
  return read(repo, run);
}

/**
 * Why onboarding can't finish while `repo` lacks a workflow label or has one under its old name; or null once it has
 * each. The status labels don't hold it, and on Azure DevOps nothing does, as the board writes a tag when it needs it.
 */
export async function workflowLabelsProblem(repo: string, run?: Run): Promise<{ status: number; error: string } | null> {
  if (onAzure(repo)) return null;
  const labels = await read(repo, run);
  if ('error' in labels) return labels;
  return workflowLabelsMissing(labelPlan(labels.labels, 'github-project'))
    ? { status: 409, error: `${repo} is missing a required label. Go back to Labels to create or rename it.` } : null;
}

/**
 * Renames each of the body's old workflow labels, or tags in its Azure DevOps project, to its new name, so its issues or
 * work items keep it; answers with the labels it has then.
 */
export async function renameRepositoryLabels(input: Record<string, unknown>, run?: Run): Answer {
  const { repo, names } = input;
  if (!isRepo(repo) || !strings(names)) return { status: 400, error: 'Send the repository and the old labels to rename.' };
  const before = await read(repo, run);
  if ('error' in before) return before;
  const plan = labelPlan(before.labels, 'github-project');
  const renames = [];
  for (const name of names) {
    const row = plan.workflow.find((r) => r.state === 'rename' && r.oldName.toLowerCase() === name.toLowerCase());
    if (row?.state === 'rename') { renames.push({ from: row.oldName, to: row.label.name }); continue; }
    const beside = plan.leftAlone.find((l) => l.name.toLowerCase() === name.toLowerCase())?.keptBeside;
    if (beside) return { status: 409, error: `${beside} already exists in ${shownRepo(repo)}. Move items to it before removing ${name}.` };
    return { status: 400, error: `${name} is not a label that can be renamed here.` };
  }
  for (const { from, to } of renames) {
    try { await (onAzure(repo) ? renameTag : renameLabel)(repo, from, to, run); }
    catch (err) { return { status: 502, error: `Couldn't rename ${from} to ${to} in ${shownRepo(repo)}: ${message(err)}` }; }
  }
  return read(repo, run);
}

/** Creates the body's typed custom label, unless the repository has it already; answers with the labels it has then. */
export async function createCustomLabel(input: Record<string, unknown>, run?: Run): Answer {
  const { repo, name } = input;
  if (!isRepo(repo) || typeof name !== 'string') return { status: 400, error: 'Send the repository and the custom label to create.' };
  if (onAzure(repo)) return NO_TAG_CREATE;
  const problem = customLabelProblem(name);
  if (problem) return { status: 400, error: problem };
  const label = name.trim();
  const before = await read(repo, run);
  if ('error' in before || before.labels.some((l) => l.toLowerCase() === label.toLowerCase())) return before;
  try { await createLabel(repo, { name: label }, run); }
  catch (err) { return { status: 502, error: `Couldn't create ${label} in ${repo}: ${message(err)}` }; }
  return read(repo, run);
}
