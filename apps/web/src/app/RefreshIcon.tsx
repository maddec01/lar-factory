// T3 Code's refresh icon, copied from apps/web/src/components/ui/refresh-icon.tsx at 9a391eb, with the
// apps/web/src/lib/visibleAnimation.ts it uses: it spins only while on screen, the window shows and
// the system allows motion. Sized by the caller, so without T3's size variants.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see app/LICENSE.

import { RefreshCwIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';

interface ObservedAnimation {
  element: HTMLElement | SVGElement;
  intersecting: boolean;
}

const animations = new Map<Element, ObservedAnimation>();
let observer: IntersectionObserver | null = null;
let reducedMotion: MediaQueryList | null = null;

function updateAnimation(animation: ObservedAnimation) {
  const running = animation.intersecting && document.visibilityState === 'visible' && !reducedMotion?.matches;
  animation.element.style.setProperty('--visible-animation-state', running ? 'running' : 'paused');
  animation.element.style.setProperty('--visible-animation-will-change', running ? 'transform' : 'auto');
}

function updateAnimations() {
  for (const animation of animations.values()) updateAnimation(animation);
}

/** Attach to a stable animation container. */
function observeVisibleAnimation(element: HTMLElement | SVGElement | null) {
  if (element === null) return;
  element.style.setProperty('--visible-animation-state', 'paused');
  element.style.setProperty('--visible-animation-will-change', 'auto');
  if (typeof IntersectionObserver === 'undefined') return;

  if (observer === null) {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.addEventListener('change', updateAnimations);
    document.addEventListener('visibilitychange', updateAnimations);
    observer = new IntersectionObserver((entries, source) => {
      if (source !== observer) return;
      for (const entry of entries) {
        const animation = animations.get(entry.target);
        if (!animation) continue;
        animation.intersecting = entry.isIntersecting;
        updateAnimation(animation);
      }
    });
  }

  const animation = { element, intersecting: false };
  animations.set(element, animation);
  observer.observe(element);

  return () => {
    if (animations.get(element) !== animation) return;
    animations.delete(element);
    observer?.unobserve(element);
    element.style.setProperty('--visible-animation-state', 'paused');
    element.style.setProperty('--visible-animation-will-change', 'auto');
    if (animations.size === 0) {
      observer?.disconnect();
      observer = null;
      reducedMotion?.removeEventListener('change', updateAnimations);
      reducedMotion = null;
      document.removeEventListener('visibilitychange', updateAnimations);
    }
  };
}

export function RefreshIcon({
  refreshing = false,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RefreshCwIcon> & { refreshing?: boolean }) {
  return (
    <RefreshCwIcon
      aria-hidden
      ref={refreshing ? observeVisibleAnimation : undefined}
      className={[refreshing && 'motion-safe:visible-animate-spin', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
