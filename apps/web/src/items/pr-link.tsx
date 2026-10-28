// A button that opens an item's pull request on GitHub, where it's verified and merged: the PR its issue links first,
// or the item itself when it is a pull request. Disabled, its title saying why, while there is none.

import { GitPullRequest } from 'lucide-react';
import { itemPr } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { LinkButton } from './link-button.tsx';
import { prototype525 } from '../title-bar/prototype-525-state.ts';

export function PrLink({ item, label }: { item: Item; label: string }) {
  const url = itemPr(item)?.url;
  // Pointer events stay on while it's disabled, so its title says why.
  if (!url) return <Button variant={prototype525 ? 'secondary' : undefined} leftIcon={prototype525 && <GitPullRequest />} className="disabled:pointer-events-auto" data-pr-link={item.id} disabled title="No pull request is linked to this item yet">{label}</Button>;
  return <LinkButton variant={prototype525 ? 'secondary' : 'primary'} leftIcon={prototype525 ? <GitPullRequest /> : undefined} data-pr-link={item.id} href={url} target="_blank" rel="noopener">{label}</LinkButton>;
}
