// One observer for the board's repeating indicators. Keep their phase while outside a scroll viewport or while
// the window is hidden; resuming never changes the status or restarts the animation. React 19 runs the returned
// cleanup when the ref detaches, including its StrictMode check.

const indicators = new Map<Element, boolean>();
let observer: IntersectionObserver | undefined;

function update(element: Element, visible: boolean): void {
  element.setAttribute('data-ambient-motion', visible && !document.hidden ? 'running' : 'paused');
}

function visibilityChanged(): void {
  for (const [element, visible] of indicators) update(element, visible);
}

export function ambientMotion(element: Element | null): (() => void) | undefined {
  if (!element) return;
  if (!indicators.size) document.addEventListener('visibilitychange', visibilityChanged);
  // Without IntersectionObserver, visibility changes still pause indicators in a hidden window.
  const visible = typeof IntersectionObserver === 'undefined';
  indicators.set(element, visible);
  update(element, visible);
  if (!visible) {
    observer ??= new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!indicators.has(target)) continue;
        indicators.set(target, isIntersecting);
        update(target, isIntersecting);
      }
    });
    observer.observe(element);
  }
  return () => {
    observer?.unobserve(element);
    indicators.delete(element);
    element.removeAttribute('data-ambient-motion');
    if (!indicators.size) {
      observer?.disconnect();
      observer = undefined;
      document.removeEventListener('visibilitychange', visibilityChanged);
    }
  };
}
