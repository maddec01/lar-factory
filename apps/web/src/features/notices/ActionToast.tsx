import type { ReactNode } from 'react';

import { useActionToast } from './useActionToast';

export function ActionToast({ children }: { children: ReactNode }) {
    useActionToast();

    return children;
}
