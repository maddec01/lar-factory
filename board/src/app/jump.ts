// Deliberate navigation to an item: bring it into view, flash it and move focus into it.

export function jumpTo(el: HTMLElement | null): void {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('anchor-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('anchor-flash');
  // The title first: on a Queued card Start comes earlier in the page, and Enter must not start a thread.
  el.querySelector<HTMLElement>('a.title, a.row-title, a, button')?.focus({ preventScroll: true });
}
