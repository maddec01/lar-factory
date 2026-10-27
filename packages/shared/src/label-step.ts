// What onboarding's Labels step finds in a repository's labels: each workflow label present, missing, or present
// under its old name to rename; for a repository that reads its issues, each status label; and every other label,
// which the step leaves alone. The board and the server read the same plan, so the server creates and renames only
// what the step offers. GitHub matches label names without case.

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
  /** The status labels, for a repository that reads its issues; empty for a GitHub Project. */
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
  const status = source === 'issues' ? STATUS_LABELS.map(row) : [];
  const leftAlone = names.filter((n) => !used.has(key(n)))
    .map((name) => ({ name, ...keptBeside.has(key(name)) && { keptBeside: keptBeside.get(key(name))! } }));
  return { workflow, status, leftAlone };
}

/** Whether a workflow label is still missing, or still under its old name; the status labels don't hold Next. */
export const workflowLabelsMissing = (plan: LabelPlan): boolean => plan.workflow.some((r) => r.state !== 'present');

/** The labels Create makes: every missing one, and each under an old name that `renaming`, Rename's old names, leaves out. */
export const labelsToCreate = (plan: LabelPlan, renaming: readonly string[]): WorkflowLabel[] => [...plan.workflow, ...plan.status]
  .filter((r) => r.state === 'missing' || r.state === 'rename' && !renaming.includes(r.oldName)).map((r) => r.label);
