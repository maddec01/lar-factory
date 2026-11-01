// What a tracker's labels can do, so the UI reads this instead of checking a provider's name.
import { onAzure } from './model.ts';
import { STRUCTURE_LABEL } from './tracker-structure.ts';

export interface TrackerCapabilities {
  /** What the tracker calls a label, in a sentence. */
  noun: string;
  /** What the tracker calls its labels, as a heading. */
  heading: string;
  /** Whether a label has a colour. */
  color: boolean;
  /** Whether a label has a description. */
  description: boolean;
  /** What deleting a label does beyond the label list. */
  deleteWarning: string;
  /** How far a change to a label reaches. */
  changeScope: 'repository' | 'project';
  /** The label structure sync needs, or null when it needs none. */
  syncLabel: string | null;
}

const GITHUB: TrackerCapabilities = {
  noun: 'label', heading: 'Labels', color: true, description: true,
  deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: STRUCTURE_LABEL,
};

const AZURE_DEVOPS: TrackerCapabilities = {
  noun: 'tag', heading: 'Tags', color: false, description: false,
  deleteWarning: 'This removes it from every work item and pull request.', changeScope: 'project', syncLabel: null,
};

/** The capabilities of the tracker holding `repo`, a repository key. */
export const trackerCapabilities = (repo: string): TrackerCapabilities => (onAzure(repo) ? AZURE_DEVOPS : GITHUB);
