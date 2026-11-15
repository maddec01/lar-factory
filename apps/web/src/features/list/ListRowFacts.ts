// What a List row says beside its title: its labels, and the tracker fields its tooltip keeps.

import { labelsOnRow, repoKey, repoName } from '@lar-factory/shared';
import type { Item, RepoConfig } from '@lar-factory/shared';

import { KIND_BADGES } from '@/features/items';

/** A work item's tracker fields the row leaves out, for its tooltip: its state and assignee, and its type only where the
 *  row's kind mark doesn't already say it. */
export function trackerFacts(item: Pick<Item, 'azure' | 'kind'>): string {
    const azure = item.azure;

    if (!azure) return '';

    return [KIND_BADGES[item.kind] ? null : azure.type, azure.state, azure.assignee].filter(Boolean).join(' · ');
}

/** The labels a row shows: none that only repeats its project's name. */
export function rowLabels(labels: readonly string[], project: string): string[] {
    const named = project.trim().toLowerCase();

    return labels.filter((label) => label.trim().toLowerCase() !== named);
}

/** The labels a List row shows for `item`: those its repository's mappings show, less its project's own name. */
export function listRowLabels(item: Item, repos: readonly RepoConfig[]): string[] {
    return rowLabels(labelsOnRow(item, repos), repoName(repoKey(item), repos));
}

/** A title as a row shows it: any run of one repeated mark (punctuation, a symbol or an emoji), such as a sprint
 *  separator's "🚀🚀🚀🚀============", cut to three, so the words after it still show; the title itself is unchanged. */
export function rowTitle(title: string): string {
    return title.replace(/((?:\p{Extended_Pictographic}\uFE0F?)|[^\p{L}\p{N}\s])\1{3,}/gu, '$1$1$1');
}

/** A List row's tooltip: its title in full, the tracker fields the row leaves out, and its labels, which a narrow list
 *  doesn't show. */
export function rowTooltip(title: string, facts: string, labels: readonly string[]): string {
    return [title, facts, labels.length ? `Labels: ${labels.join(', ')}` : ''].filter(Boolean).join('\n');
}
