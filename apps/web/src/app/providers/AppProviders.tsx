// What every screen of the board sits in: the design system's provider, with its English labels as the board has
// no localization, which also draws every lucide icon at the design system's stroke, and the provider its Tooltip
// needs. The page mounts the design system's Notifications once, as a stack, in app/App.tsx.

import { DesignSystemProvider, TooltipProvider } from '@lar-works/design-system';
import type { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <DesignSystemProvider>
            <TooltipProvider>{children}</TooltipProvider>
        </DesignSystemProvider>
    );
}
