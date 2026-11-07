// What the Labels section's parts share: a capitalised noun, the note on a project's other mappings, and a problem line.

import { Text } from '@lar-works/design-system';

export const capitalized = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

export const OTHER_MAPPINGS = "Kind mappings in the project's other onboarded repositories update too.";

export function ProblemText({ children }: { children: string | null }) {
    return (
        children && (
            <Text variant="caption" tone="danger" role="alert">
                {children}
            </Text>
        )
    );
}
