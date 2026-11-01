// What a tracker's labels can do, so the UI reads this instead of checking a provider's name.
import { customLabelProblem, customTagProblem } from './custom-labels.ts';
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
  /** Why a label can't be created by itself, or null when it can. */
  createUnavailable: string | null;
  /** Why a person can't give a label this name, or null when they can. */
  nameProblem(name: string): string | null;
}

export interface TrackerLabel {
  name: string;
  /** Six hex digits, with no `#`. */
  color?: string;
  description?: string;
}

/**
 * A tracker's label operations, whose adapters are in tracker-labels.ts. Adding or removing labels on a ticket changes only those
 * names, since replacing the ticket's whole set from a read that stopped short would drop the rest.
 */
export interface TrackerLabels {
  list(): Promise<TrackerLabel[]>;
  create(label: TrackerLabel): Promise<TrackerLabel>;
  /** Renames the label `name` and changes its colour or description, each only when given. */
  update(name: string, change: Partial<TrackerLabel>): Promise<TrackerLabel>;
  delete(name: string): Promise<void>;
  addToTicket(ticket: number, names: readonly string[]): Promise<void>;
  removeFromTicket(ticket: number, names: readonly string[]): Promise<void>;
}

const GITHUB: TrackerCapabilities = {
  noun: 'label', heading: 'Labels', color: true, description: true,
  deleteWarning: 'This removes it from every ticket.', changeScope: 'repository', syncLabel: STRUCTURE_LABEL, createUnavailable: null, nameProblem: customLabelProblem,
};

const AZURE_DEVOPS: TrackerCapabilities = {
  noun: 'tag', heading: 'Tags', color: false, description: false,
  deleteWarning: 'This removes it from every work item and pull request.', changeScope: 'project', syncLabel: null,
  createUnavailable: 'Azure DevOps has no way to create a tag on its own. A new tag appears when it is first added to a work item.',
  nameProblem: customTagProblem,
};

/** The capabilities of the tracker holding `repo`, a repository key. */
export const trackerCapabilities = (repo: string): TrackerCapabilities => (onAzure(repo) ? AZURE_DEVOPS : GITHUB);
