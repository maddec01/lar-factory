// A wrapper for what sits on a clickable item but shouldn't open it: its buttons, the menus they open, a start message.
// React carries a click in a portalled menu up through the button that opened it, so the wrapper holds those too.

import type { ReactNode } from 'react';

/**
 * Keeps the clicks inside from reaching the item underneath. With `passEmpty`, a click on the wrapper's own empty space,
 * beside and between what it holds, still reaches the item.
 */
export function KeepClicks({ as: Tag = 'div', className, passEmpty = false, children }: {
  as?: 'div' | 'span'; className?: string; passEmpty?: boolean; children: ReactNode;
}) {
  return <Tag className={className} onClick={(e) => { if (!passEmpty || e.target !== e.currentTarget) e.stopPropagation(); }}>{children}</Tag>;
}
