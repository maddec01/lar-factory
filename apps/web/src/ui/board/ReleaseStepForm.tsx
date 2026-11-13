import { Alert, Button, Field, Inline, Input, Stack, Text } from '@lar-works/design-system';
import { useId } from 'react';

import { buttonKind } from './ButtonKinds';

export function ReleaseStepForm({
    what,
    evidence,
    onEvidence,
    onComplete,
    pending,
    error,
}: {
    what: string;
    evidence: string;
    onEvidence: (value: string) => void;
    onComplete: () => void;
    pending: boolean;
    error?: string | null;
}) {
    const id = useId();

    return (
        <Stack space="tight" data-release-step-form>
            <Text>{what}</Text>
            <Field label="Release evidence" id={id}>
                <Input
                    id={id}
                    value={evidence}
                    maxLength={1000}
                    disabled={pending}
                    placeholder="What confirms this step is done?"
                    onChange={(event) => onEvidence(event.target.value)}
                />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Inline wrap>
                <Button
                    {...buttonKind('main')}
                    loading={pending}
                    disabled={!evidence.trim() || pending}
                    onClick={onComplete}
                >
                    Mark release step done
                </Button>
            </Inline>
        </Stack>
    );
}
