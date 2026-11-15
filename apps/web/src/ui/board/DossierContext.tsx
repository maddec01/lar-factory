// Parent context and the item's own state alongside its group summary in a dock row.
import type { ReactNode } from 'react';

export function DossierParentContext({ children }: { children: ReactNode }) {
    return (
        <span className="block min-w-0 truncate" data-parent-context>
            {children}
        </span>
    );
}

export function DossierStates({ children }: { children: ReactNode }) {
    return (
        <span className="flex min-w-0 items-center justify-end gap-x-3 whitespace-nowrap [&>*]:min-w-0 [&>*]:truncate [&>*:first-child]:shrink-0">
            {children}
        </span>
    );
}
