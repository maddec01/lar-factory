// The GitHub side of onboarding's Labels step: reads a repository's labels, creates the workflow labels it lacks (and
// for a repository that reads its issues, its status labels), and renames old workflow labels to their new names. It
// reads the labels again before each change and works only from the shared label plan, so it changes no other label.

import { STATUSES, labelPlan, labelsToCreate, statusLabel, type Status } from '@lar-factory/shared';
import { isItemSource, isRepo } from '../config/repository-config.ts';
import { createLabel, createStatusLabel, listLabels, message, renameLabel } from '../github/github.ts';

type Run = (args: string[]) => Promise<string>;
type Answer = Promise<{ labels: string[] } | { status: number; error: string }>;

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** The repository's labels, or why gh can't read them. */
async function read(repo: string, run?: Run): Answer {
  try { return { labels: await listLabels(repo, run) }; }
  catch (err) { return { status: 502, error: `Can't read ${repo}'s labels: ${message(err)}` }; }
}

/** Lists the body's repository's labels. */
export async function readRepositoryLabels(input: Record<string, unknown>, run?: Run): Answer {
  if (!isRepo(input.repo)) return { status: 400, error: 'Send the repository whose labels to read.' };
  return read(input.repo, run);
}

/**
 * Creates every label the step finds missing in the body's repository, read through its item source, except those
 * under an old name in `renaming`, which Rename moves instead; answers with the labels it has then.
 */
export async function createRepositoryLabels(input: Record<string, unknown>, run?: Run): Answer {
  const { repo, itemSource, renaming } = input;
  if (!isRepo(repo) || !isItemSource(itemSource) || !strings(renaming)) {
    return { status: 400, error: 'Send the repository, its item source and the old labels Rename moves.' };
  }
  const before = await read(repo, run);
  if ('error' in before) return before;
  for (const label of labelsToCreate(labelPlan(before.labels, itemSource.kind), renaming)) {
    const status = STATUSES.find((s): s is Exclude<Status, 'Done'> => s !== 'Done' && statusLabel(s) === label.name);
    if (status) {
      const error = await createStatusLabel(repo, status, run);
      if (error) return { status: 502, error };
      continue;
    }
    try { await createLabel(repo, label, run); }
    catch (err) { return { status: 502, error: `Couldn't create ${label.name} in ${repo}: ${message(err)}` }; }
  }
  return read(repo, run);
}

/** Renames each of the body's old workflow labels to its new name, so its issues keep it; answers with the labels it has then. */
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
    if (beside) return { status: 409, error: `${repo} has ${beside} already, so ${name} can't be renamed to it.` };
    return { status: 400, error: `${name} is no old workflow label the repository has.` };
  }
  for (const { from, to } of renames) {
    try { await renameLabel(repo, from, to, run); }
    catch (err) { return { status: 502, error: `Couldn't rename ${from} to ${to} in ${repo}: ${message(err)}` }; }
  }
  return read(repo, run);
}
