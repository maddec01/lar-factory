// A button that opens an item's pull request on GitHub, where it's verified and merged: the PR its issue links first,
// or the item itself when it is a pull request. Disabled, its title saying why, while there is none.

import type { Item } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';

/** The item's pull request: itself when it is one, else the first PR it links. */
const prUrl = (item: Item): string | undefined =>
  item.type === 'PullRequest' ? item.url ?? undefined : item.linkedPrs[0]?.url;

export function PrLink({ item, label, size = 'sm' }: { item: Item; label: string; size?: 'xs' | 'sm' }) {
  const url = prUrl(item);
  // Pointer events stay on while it's disabled, so its title says why.
  if (!url) return <Button size={size} className="disabled:pointer-events-auto" data-pr-link={item.id} disabled title="No pull request is linked to this item yet">{label}</Button>;
  return <Button size={size} data-pr-link={item.id} render={<a href={url} target="_blank" rel="noopener" />}>{label}</Button>;
}
