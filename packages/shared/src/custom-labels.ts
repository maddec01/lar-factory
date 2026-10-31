// The custom labels a repository's settings offer when adding work: any label name except those that give an imported
// ticket its kind or Status. On Azure DevOps the labels are tags. GitHub matches label names without case.

/** The labels that give an item's kind, as labelKind reads them; `decision-` starts a decision's. */
const KIND_LABELS = ['bug', 'feature', 'improvement', 'concept', 'build'];

/** Whether a label named `name` gives an item's kind: bug, feature, improvement or concept. */
export const isKindLabel = (name: string) => KIND_LABELS.slice(0, 4).includes(name.toLowerCase());

/** The longest label name GitHub takes. */
const LONGEST_LABEL = 50;

/** Why `name` can't be a custom label, or null when it can; it may hold a colon. */
export function customLabelProblem(name: string): string | null {
  const typed = name.trim().toLowerCase();
  if (!typed) return 'Enter a label name.';
  if (typed.length > LONGEST_LABEL) return `Use at most ${LONGEST_LABEL} characters. This name has ${typed.length}.`;
  if (typed.startsWith('-')) return 'Do not start the label name with a hyphen.';
  if (KIND_LABELS.includes(typed) || typed.startsWith('decision-')) return `${name.trim()} is reserved for the item's kind.`;
  if (typed.startsWith('status-')) return `${name.trim()} is reserved for board status.`;
  return null;
}

/** Why `name` can't be a custom tag on Azure DevOps, or null when it can: a custom label's problems, and System.Tags's separators. */
export const customTagProblem = (name: string): string | null =>
  customLabelProblem(name) ?? (/[,;]/.test(name) ? 'Use a tag name without commas or semicolons.' : null);
