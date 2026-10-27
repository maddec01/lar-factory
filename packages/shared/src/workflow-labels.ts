/** A label the lar workflow sets on issues, as `skills/lar-work/issue-tracker.md`'s label setup creates it. */
export interface WorkflowLabel {
  name: string;
  color: string;
  description: string;
}

/** Every workflow label, in the label setup's order. */
export const WORKFLOW_LABELS: readonly WorkflowLabel[] = [
  { name: 'bug', color: 'D73A4A', description: 'Something broken' },
  { name: 'feature', color: 'A2EEEF', description: 'New behaviour' },
  { name: 'improvement', color: '1D76DB', description: 'Better existing behaviour' },
  { name: 'concept', color: '5319E7', description: 'A map of work needing decisions and builds' },
  { name: 'decision-grill', color: 'D4C5F9', description: 'Concept decision settled by questions' },
  { name: 'decision-prototype', color: 'D4C5F9', description: 'Concept decision settled by a prototype' },
  { name: 'decision-research', color: 'D4C5F9', description: 'Concept decision settled by research' },
  { name: 'decision-task', color: 'D4C5F9', description: 'Concept decision settled by a small task' },
  { name: 'build', color: '0E8A16', description: 'Issue that becomes one PR' },
  { name: 'active', color: 'FBCA04', description: 'Slice an implementer is working on now' },
  { name: 'blocked', color: 'BFD4F2', description: "Slice an implementer couldn't finish, waiting for a re-slice" },
];

/** The labels that give an item's kind. */
const KIND_LABELS = ['bug', 'feature', 'improvement', 'concept'];

/** Whether a label named `name` gives an item's kind: bug, feature, improvement or concept; GitHub matches label names without case. */
export const isKindLabel = (name: string) => KIND_LABELS.includes(name.toLowerCase());
