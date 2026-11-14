import { Button, Field, Inline, Input, Stack, Text } from '@lar-works/design-system';
import { useId } from 'react';

import { buttonKind } from './ButtonKinds';

export function BriefChanges({
    note,
    onNote,
    pending,
    onSubmit,
}: {
    note: string;
    onNote: (note: string) => void;
    pending: boolean;
    onSubmit: () => void;
}) {
    const id = useId();

    return (
        <Stack space="tight">
            <Field label="Changes requested" id={id}>
                <Input
                    id={id}
                    value={note}
                    maxLength={10000}
                    disabled={pending}
                    onChange={(event) => onNote(event.target.value)}
                />
            </Field>
            <Text variant="caption" tone="muted">
                Returns the displayed items to Shaping and sends your note to their shaping owners.
            </Text>
            <Inline wrap>
                <Button {...buttonKind('other')} disabled={pending || !note.trim()} onClick={onSubmit}>
                    Send change request
                </Button>
            </Inline>
        </Stack>
    );
}
