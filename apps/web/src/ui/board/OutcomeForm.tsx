import { Alert, Button, Field, Inline, Input, Stack, Text } from '@lar-works/design-system';
import { useId } from 'react';

import { buttonKind } from './ButtonKinds';

/** A parent delivery receipt, with the same evidence-entry pattern as release steps. */
export function OutcomeForm({
    what,
    evidence,
    onEvidence,
    onResult,
    pending,
    error,
}: {
    what: string;
    evidence: string;
    onEvidence: (value: string) => void;
    onResult: (result: 'passed' | 'failed') => void;
    pending: boolean;
    error?: string | null;
}) {
    const id = useId();

    return (
        <Stack space="tight" data-outcome-form>
            <Text>{what}</Text>
            <Field label="Outcome evidence" id={id}>
                <Input
                    id={id}
                    value={evidence}
                    maxLength={1000}
                    disabled={pending}
                    placeholder="What did you check, and what happened?"
                    onChange={(event) => onEvidence(event.target.value)}
                />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Inline wrap>
                <Button
                    {...buttonKind('main')}
                    disabled={!evidence.trim() || pending}
                    loading={pending}
                    onClick={() => onResult('passed')}
                >
                    Outcome passed
                </Button>
                <Button
                    {...buttonKind('other')}
                    disabled={!evidence.trim() || pending}
                    onClick={() => onResult('failed')}
                >
                    Outcome failed
                </Button>
            </Inline>
        </Stack>
    );
}
