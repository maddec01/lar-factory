// A button that opens an item's pull request on GitHub, where it's verified and merged: the PR its issue links first,
// or the item itself when it is a pull request. Disabled, its title saying why, while there is none.

import { itemPr } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';

export function PrLink({ item, label, size = 'sm' }: { item: Item; label: string; size?: 'xs' | 'sm' }) {
  const url = itemPr(item)?.url;
  // Pointer events stay on while it's disabled, so its title says why.
  if (!url) return <Button size={size} className="disabled:pointer-events-auto" data-pr-link={item.id} disabled title="No pull request is linked to this item yet">{label}</Button>;
  return <Button size={size} data-pr-link={item.id} render={<a href={url} target="_blank" rel="noopener" />}>{label}</Button>;
}
