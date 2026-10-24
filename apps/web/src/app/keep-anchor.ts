// Keeps the item at the top of the window where it is when new data changes what's above it.
// anchor.ts picks the item; this measures the page's [data-anchor] elements.

import { anchorKeys, survivingAnchor } from '../anchor.ts';

type Anchor = { keys: string[]; index: number; tops: number[] };

let held: Anchor | null = null;

/** The items on screen in page order: items in closed groups have no boxes. */
function anchorElements(): { keys: string[]; els: HTMLElement[] } {
  const els = [...document.querySelectorAll<HTMLElement>('[data-anchor]')].filter((el) => el.getClientRects().length > 0);
  return { keys: anchorKeys(els.map((el) => el.dataset.anchor!)), els };
}

/** Notes the top-most item in the window and where it sits, before new data renders; nothing at the top of the page, which stays there. */
export function holdAnchor(): void {
  held = null;
  if (window.scrollY < 1) return;
  const { keys, els } = anchorElements();
  const visible = (el: HTMLElement) => el.getBoundingClientRect().bottom > 0;
  // Innermost: a concept card's sub-issue row rather than the card around it.
  const index = els.findIndex((el, i) => visible(el) && !els.slice(i + 1).some((inner) => el.contains(inner) && visible(inner)));
  if (index >= 0) held = { keys, index, tops: els.map((el) => el.getBoundingClientRect().top) };
}

/** After the render: puts that item, or the nearest one that survived, back where it was. */
export function restoreAnchor(): void {
  const anchor = held;
  held = null;
  if (!anchor) return;
  const { keys, els } = anchorElements();
  const key = survivingAnchor(anchor.keys, anchor.index, new Set(keys));
  if (!key) return;
  // The survivor goes back to where it was itself, not where the vanished item was.
  window.scrollBy(0, els[keys.indexOf(key)]!.getBoundingClientRect().top - anchor.tops[anchor.keys.indexOf(key)]!);
}
