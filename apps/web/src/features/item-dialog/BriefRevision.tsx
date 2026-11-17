import { briefProse } from '@lar-factory/shared';
import { RichText, Stack, Text } from '@lar-works/design-system';

/** Show the changed passage beside the complete proposed brief. */
export function BriefRevision({ before, after }: { before: string; after: string }) {
    const old = briefProse(before).split('\n');
    const current = briefProse(after).split('\n');
    let start = 0;
    let end = 0;

    while (start < old.length && start < current.length && old[start] === current[start]) start++;

    while (
        end < old.length - start &&
        end < current.length - start &&
        old[old.length - end - 1] === current[current.length - end - 1]
    )
        end++;

    const removed = old.slice(start, old.length - end).join('\n');
    const added = current.slice(start, current.length - end).join('\n');

    if (!removed && !added) return null;

    return (
        <Stack space="tight">
            <Text>Changes since your approval</Text>
            {removed && (
                <Stack space="tight">
                    <Text>Previously</Text>
                    <RichText text={removed} format="markdown" />
                </Stack>
            )}
            {added && (
                <Stack space="tight">
                    <Text>Now</Text>
                    <RichText text={added} format="markdown" />
                </Stack>
            )}
        </Stack>
    );
}
