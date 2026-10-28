// What onboarding's Labels step finds in a repository's labels: each workflow label present, missing, or present
// under its old name to rename; for a repository that reads its issues or an Azure DevOps team's work items, each
// status label; and every other label, which the step leaves alone. On Azure DevOps the labels are the project's tags. The custom labels to pick come from those left alone. The board and the server read the
// same plan, so the server creates and renames only what the step offers. GitHub matches label names without case.

import { STATUSES, statusLabel, type RepositoryItemSource } from './model.ts';
import { WORKFLOW_LABELS, type WorkflowLabel } from './workflow-labels.ts';

/** The status labels a repository that reads its issues carries, as the server's createStatusLabel makes them. */
export const STATUS_LABELS: readonly WorkflowLabel[] = STATUSES.filter((s) => s !== 'Done')
  .map((s) => ({ name: statusLabel(s), color: 'EDEDED', description: `Status: ${s}` }));

/** A label the step needs: present, missing, or present under its old name, which Rename moves to the new one. */
export type LabelRow = { label: WorkflowLabel; state: 'present' | 'missing' } | { label: WorkflowLabel; state: 'rename'; oldName: string };

/** A label the step leaves alone; `keptBeside` names the new label for an old name the repository has both of. */
export interface LeftAloneLabel {
  name: string;
  keptBeside?: string;
}

export interface LabelPlan {
  workflow: LabelRow[];
  /** The status labels, for an item source that reads status-<name> labels or tags; empty for a GitHub Project. */
  status: LabelRow[];
  leftAlone: LeftAloneLabel[];
}

const key = (name: string) => name.toLowerCase();

/** The step's plan for a repository with labels `names`, read through `source`. */
export function labelPlan(names: readonly string[], source: RepositoryItemSource['kind']): LabelPlan {
  const has = new Map(names.map((n) => [key(n), n]));
  const used = new Set<string>();
  const keptBeside = new Map<string, string>();
  const row = (label: WorkflowLabel): LabelRow => {
    if (has.has(key(label.name))) {
      used.add(key(label.name));
      const old = label.oldName && has.get(key(label.oldName));
      if (old) keptBeside.set(key(old), label.name);
      return { label, state: 'present' };
    }
    const old = label.oldName && has.get(key(label.oldName));
    if (!old) return { label, state: 'missing' };
    used.add(key(old));
    return { label, state: 'rename', oldName: old };
  };
  const workflow = WORKFLOW_LABELS.map(row);
  const status = source === 'github-project' ? [] : STATUS_LABELS.map(row);
  const leftAlone = names.filter((n) => !used.has(key(n)))
    .map((name) => ({ name, ...keptBeside.has(key(name)) && { keptBeside: keptBeside.get(key(name))! } }));
  return { workflow, status, leftAlone };
}

/** Whether a workflow label is still missing, or still under its old name; the status labels don't hold Next. */
export const workflowLabelsMissing = (plan: LabelPlan): boolean => plan.workflow.some((r) => r.state !== 'present');

/** The labels Create makes: every missing one, and each under an old name that `renaming`, Rename's old names, leaves out. */
export const labelsToCreate = (plan: LabelPlan, renaming: readonly string[]): WorkflowLabel[] => [...plan.workflow, ...plan.status]
  .filter((r) => r.state === 'missing' || r.state === 'rename' && !renaming.includes(r.oldName)).map((r) => r.label);


/**
 * The labels the step offers as custom labels: those it leaves alone, less any status label, any repo- tag that routes an
 * Azure work item to its repository, and any old name kept beside its new label.
 */
export const customLabelChoices = (plan: LabelPlan): string[] =>
  plan.leftAlone.filter((l) => !l.keptBeside && !/^(status|repo)-/.test(key(l.name))).map((l) => l.name);

/** The longest label name GitHub takes. */
const LONGEST_LABEL = 50;

/** Why `name` can't be a custom label, or null when it can; unlike a workflow label, it may hold a colon. */
export function customLabelProblem(name: string): string | null {
  const typed = key(name.trim());
  if (!typed) return 'Enter a label name.';
  if (typed.length > LONGEST_LABEL) return `Use at most ${LONGEST_LABEL} characters. This name has ${typed.length}.`;
  if (typed.startsWith('-')) return 'Do not start the label name with a hyphen.';
  if (WORKFLOW_LABELS.some((l) => key(l.name) === typed || l.oldName && key(l.oldName) === typed)) return `${name.trim()} is reserved for tracking work.`;
  if (typed.startsWith('status-')) return `${name.trim()} is reserved for board status.`;
  return null;
}

/** Why `name` can't be a custom tag on Azure DevOps, or null when it can: a custom label's problems, and System.Tags's separators. */
export const customTagProblem = (name: string): string | null =>
  customLabelProblem(name) ?? (/[,;]/.test(name) ? 'Use a tag name without commas or semicolons.' : null);

/**
 * The custom labels in `custom`, such as a reused .lar-factory.json's, that a repository with labels `names` lacks and
 * Create can make: one `customLabelProblem` refuses is left out, so the workflow labels are still made.
 */
export const missingCustomLabels = (names: readonly string[], custom: readonly string[]): string[] =>
  custom.filter((c) => !customLabelProblem(c) && !names.some((n) => key(n) === key(c)));
