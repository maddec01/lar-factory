import { Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

/** Phone maps keep every card in view, with named dependencies in place of offscreen arrows. */
export function MapStack({ children }: { children: ReactNode }) {
    return (
        <div className="grid min-w-0 gap-4 p-3" data-map-stack>
            {children}
        </div>
    );
}

export function MapStackItem({ label, after, children }: { label: ReactNode; after: string; children: ReactNode }) {
    return (
        <div className="grid min-w-0 gap-2">
            <div className="text-fg-muted flex min-w-0 items-center gap-1.5 text-xs">{label}</div>
            {after && (
                <Text variant="caption" tone="muted" breaks>
                    After: {after}
                </Text>
            )}
            {children}
        </div>
    );
}
