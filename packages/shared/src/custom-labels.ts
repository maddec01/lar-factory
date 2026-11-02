// The label names a person may choose: any except the managed labels. On Azure DevOps the labels are tags.
import { isManagedLabel } from './managed-labels.ts';
import { STATUS_LABEL_PREFIX, isRepoTag } from './model.ts';
import { STRUCTURE_LABEL } from './tracker-structure.ts';

/** The longest label name GitHub takes. */
const LONGEST_LABEL = 50;

/** Why `name` can't be a custom label, or null when it can; it may hold a colon. */
export function customLabelProblem(name: string): string | null {
  const typed = name.trim().toLowerCase();
  if (!typed) return 'Enter a label name.';
  if (typed.length > LONGEST_LABEL) return `Use at most ${LONGEST_LABEL} characters. This name has ${typed.length}.`;
  if (typed.startsWith('-')) return 'Do not start the label name with a hyphen.';
  if (!isManagedLabel(typed)) return null;
  if (typed === STRUCTURE_LABEL) return `${name.trim()} is reserved for the factory's saved links.`;
  return `${name.trim()} is reserved for ${typed.startsWith(STATUS_LABEL_PREFIX) ? 'board status' : "the item's kind"}.`;
}

/** Why `name` can't be one tag on a work item, or null when it can: System.Tags separates its tags with these. */
export const tagSeparatorProblem = (name: string): string | null => (/[,;]/.test(name) ? 'Use a tag name without commas or semicolons.' : null);

/** Why `name` can't be a custom tag on Azure DevOps, or null when it can: a custom label's problems, the tag that places a work item, and separators. */
export const customTagProblem = (name: string): string | null =>
  customLabelProblem(name) ?? (isRepoTag(name) ? `${name.trim()} is reserved for the work item's repository.` : tagSeparatorProblem(name));
