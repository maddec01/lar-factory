// The page's one route. The hash picks the view: #flow for Flow, none for the Board.

import { createRootRoute, createRouter, useLocation, useNavigate } from '@tanstack/react-router';
import { App } from './App.tsx';
import type { View } from '../ui-state.ts';

const rootRoute = createRootRoute({ component: App });

export const router = createRouter({ routeTree: rootRoute });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function useView(): View {
  return useLocation({ select: (location) => (location.hash === 'flow' ? 'flow' : 'board') });
}

/** Switches the view in place, so Back leaves the board rather than the tab. */
export function useSetView(): (view: View) => void {
  const navigate = useNavigate();
  return (view) => void navigate({ to: '.', hash: view === 'flow' ? 'flow' : undefined, replace: true });
}
