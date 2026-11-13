import { Disclosure, Stack, Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

export function SavedRunSection({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Disclosure label={label} presentation="section" data-saved-run="">
            <Stack space="related">
                <Text variant="caption" tone="muted">
                    These choices were saved for this run. Later Settings changes do not alter them.
                </Text>
                {children}
            </Stack>
        </Disclosure>
    );
}
