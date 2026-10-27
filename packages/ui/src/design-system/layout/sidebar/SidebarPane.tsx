import type { ReactNode } from 'react';

import { Text } from '../../typography/Typography';

interface SidebarPaneProps {
    children: ReactNode;
    label: string;
}

export function SidebarPane({ children, label }: SidebarPaneProps) {
    return (
        <aside className="w-full border-y border-base-300 bg-base-100/40 md:h-full md:border-y-0 md:border-r dark:bg-black/20">
            <nav
                aria-label={label}
                className="flex items-center gap-1 overflow-x-auto overscroll-contain p-3 md:h-full md:flex-col md:items-stretch md:gap-1 md:overflow-y-auto md:px-3 md:py-4"
            >
                {children}
            </nav>
        </aside>
    );
}

interface SidebarNavigationGroupProps {
    children: ReactNode;
    label: string;
}

export function SidebarNavigationGroup({ children, label }: SidebarNavigationGroupProps) {
    return (
        <div role="group" aria-label={label} className="flex shrink-0 gap-1 md:mb-4 md:flex-col md:last:mb-0">
            <Text as="span" className="hidden h-7 px-2 leading-7 font-medium md:block" variant="caption" tone="muted">
                {label}
            </Text>
            {children}
        </div>
    );
}
