// Settings' Labels section. The tracker holds the only copy, so every change goes straight to it and nothing is saved here.
import { isManagedLabel, isRecord, sameRepo, trackerCapabilities, writeAccessProblem, type TrackerCapabilities, type TrackerLabel, type TrackerLabels } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { notEditable, type Refused } from './editable-repository.ts';
import { isRepo } from './repository-config.ts';

/** A tracker's adapter and what it can do. */
interface Tracker {
  labels: TrackerLabels;
  capabilities: TrackerCapabilities;
}

const refuse = (problem: string | null) => { if (problem) throw new Error(problem); };

/** The new name `typed`, once the tracker takes it. */
function newName(typed: unknown, capabilities: TrackerCapabilities): string {
  const name = typeof typed === 'string' ? typed : '';
  refuse(capabilities.nameProblem(name));
  return name.trim();
}

/** The change a rename or edit sends: only what the tracker's labels have. */
function labelChange(update: unknown, capabilities: TrackerCapabilities): Partial<TrackerLabel> {
  if (!isRecord(update)) throw new Error(`Send the change to this ${capabilities.noun}.`);
  const { name, color, description } = update;
  if (color !== undefined) refuse(!capabilities.color ? `A ${capabilities.noun} has no colour.` : typeof color !== 'string' || !/^[0-9a-f]{6}$/i.test(color) ? 'Use a colour of six hex digits.' : null);
  if (description !== undefined) refuse(!capabilities.description ? `A ${capabilities.noun} has no description.` : typeof description !== 'string' ? 'Use text for the description.' : null);
  return { ...name !== undefined && { name: newName(name, capabilities) }, ...color !== undefined && { color: color as string }, ...description !== undefined && { description: description as string } };
}

/** Reads the tracker's labels, or changes one when the signed-in account may manage them and the name isn't managed. */
export async function changeRepositoryLabels(input: Record<string, unknown>, dir = boardDataDir(), tracker?: Tracker): Promise<{ labels?: TrackerLabel[] } | Refused> {
  const { repo, change, name, update } = input;
  if (!isRepo(repo) || !['list', 'create', 'update', 'delete'].includes(change as string)) return { status: 400, error: 'Send the repository and the change to its labels.' };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  const { labels, capabilities } = tracker ?? { labels: trackerLabels(repo), capabilities: trackerCapabilities(repo) };
  try {
    if (change === 'list') return { labels: await labels.list() };
    refuse(writeAccessProblem(repo, 'manage-labels', readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))?.access ?? {}));
    if (change === 'create') {
      refuse(capabilities.createUnavailable);
      await labels.create({ name: newName(name, capabilities) });
      return {};
    }
    if (typeof name !== 'string' || !name) throw new Error(`Choose a ${capabilities.noun}.`);
    if (isManagedLabel(name)) refuse(capabilities.nameProblem(name));
    if (change === 'delete') await labels.delete(name);
    else await labels.update(name, labelChange(update, capabilities));
    return {};
  } catch (err) {
    return { status: 400, error: (err as Error).message };
  }
}
