import {
    Alert,
    Button,
    Disclosure,
    Field,
    Input,
    Inline,
    Loading,
    RichText,
    Stack,
    Text,
} from '@lar-works/design-system';
import { useId, useState } from 'react';

import { buttonKind } from './ButtonKinds';

interface Props {
    head?: string;
    testSteps?: string;
    loading: boolean;
    pending: boolean;
    error?: string | null;
    note: string;
    onNote: (value: string) => void;
    onRefresh: () => void;
    onResult: (result: 'pass' | 'fail') => void;
}

/** Record a result in item details; only a failure asks for a note. */
export function VerifyResult({ head, testSteps, loading, pending, error, note, onNote, onRefresh, onResult }: Props) {
    const noteId = useId();
    const [failing, setFailing] = useState(false);

    return (
        <Stack space="tight" data-verification>
            <Disclosure label="Test steps" presentation="section" defaultOpen>
                {loading ? (
                    <Loading presentation="inline" label="Reading PR Test steps…" />
                ) : error && !head ? (
                    <Text tone="muted">Test steps could not be read. Re-read PR head to try again.</Text>
                ) : testSteps ? (
                    <RichText text={testSteps} format="markdown" />
                ) : (
                    <Text tone="muted">No Test steps found in the PR. Ask for them in the failure note.</Text>
                )}
            </Disclosure>
            {head && (
                <Text variant="caption" tone="muted" breaks>
                    Testing head {head.slice(0, 7)}
                </Text>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            <Inline wrap>
                {!failing && (
                    <>
                        <Button
                            {...buttonKind('main', { size: 'md' })}
                            disabled={pending || loading || !head || !testSteps}
                            onClick={() => onResult('pass')}
                        >
                            Pass
                        </Button>
                        <Button
                            {...buttonKind('other', { tone: 'danger', size: 'md' })}
                            disabled={pending || loading || !head}
                            aria-expanded={failing}
                            aria-controls={failing ? noteId : undefined}
                            onClick={() => setFailing(true)}
                        >
                            Fail
                        </Button>
                    </>
                )}
                <Button {...buttonKind('other', { size: 'md' })} disabled={pending || loading} onClick={onRefresh}>
                    Re-read PR head
                </Button>
            </Inline>
            {failing && (
                <Stack space="tight">
                    <Field label="Failure note" id={noteId}>
                        <Input
                            id={noteId}
                            autoFocus
                            value={note}
                            maxLength={1000}
                            disabled={pending}
                            placeholder="What needs fixing?"
                            onChange={(event) => onNote(event.target.value)}
                        />
                    </Field>
                    <Inline wrap>
                        <Button
                            {...buttonKind('main', { tone: 'danger', size: 'md' })}
                            disabled={pending || loading || !head || !note.trim()}
                            onClick={() => onResult('fail')}
                        >
                            Submit failure
                        </Button>
                        <Button
                            {...buttonKind('other', { size: 'md' })}
                            disabled={pending}
                            onClick={() => setFailing(false)}
                        >
                            Cancel
                        </Button>
                    </Inline>
                </Stack>
            )}
        </Stack>
    );
}

export function VerifyEvidence({ children }: { children: React.ReactNode }) {
    return (
        <Text variant="caption" breaks data-verify-evidence>
            {children}
        </Text>
    );
}
