// The Labels section's note on a project's other mappings, and its problem line.

import { Alert } from '@lar-works/design-system';

export const OTHER_MAPPINGS = 'Kind mappings in the project’s other onboarded repositories update too.';

export function ProblemText({ children }: { children: string | null }) {
    return (
        children && (
            <Alert size="sm" tone="danger">
                {children}
            </Alert>
        )
    );
}
