// What every screen of the board sits in: the design system's provider, with its English labels as the board has
// no localization, which also draws every lucide icon at the design system's stroke, and the provider its Tooltip
// needs. The board's toasts render through its own notification stack (features/notices), so the design system's
// Notifications, which would show each toast a second time, stays out.

import { DesignSystemProvider, TooltipProvider } from '@lar-works/design-system';
import type { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <DesignSystemProvider>
            <TooltipProvider>{children}</TooltipProvider>
        </DesignSystemProvider>
    );
}
