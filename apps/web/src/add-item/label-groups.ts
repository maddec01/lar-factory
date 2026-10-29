// Label groups: a repository's custom labels grouped by the text before ": ", the way Add item shows them.

export interface LabelOption { label: string; text: string }
export interface LabelGroup { heading: string; options: LabelOption[] }

const SEPARATOR = ': ';

/** The labels by prefix in first-seen order, each option showing the text after it; unprefixed labels last, under "Other". */
export function labelGroups(labels: readonly string[]): LabelGroup[] {
  const groups = new Map<string, LabelOption[]>();
  const other: LabelOption[] = [];
  for (const label of labels) {
    const at = label.indexOf(SEPARATOR);
    if (at < 0) other.push({ label, text: label });
    else {
      const heading = label.slice(0, at);
      groups.set(heading, [...(groups.get(heading) ?? []), { label, text: label.slice(at + SEPARATOR.length) }]);
    }
  }
  return [...[...groups].map(([heading, options]) => ({ heading, options })), ...(other.length ? [{ heading: 'Other', options: other }] : [])];
}
