// Parent context and the item's own state alongside its group summary in a dock row.
import type { ReactNode } from 'react';

export function DossierParentContext({ children }: { children: ReactNode }) {
    return (
        <span className="min-w-0 whitespace-normal" data-parent-context>
            {children}
        </span>
    );
}

export function DossierStates({ children }: { children: ReactNode }) {
    return <span className="grid min-w-0 gap-1 [&_[data-state]]:whitespace-normal">{children}</span>;
}
