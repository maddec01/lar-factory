import { briefProse } from '@lar-factory/shared';
import { Alert, Button, Disclosure, Inline, RichText, Stack, Text } from '@lar-works/design-system';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';

import { BriefRevision } from './BriefRevision';
import { postAction, receive } from '@/services/board/board.service';
import { forgetItemDetails } from '@/services/items/items.hooks';
import { MarkdownDiagrams } from '@/shared/diagrams/MarkdownDiagrams';
import { BriefApprovalDetails, BriefChanges, buttonKind } from '@/ui/board';

interface Approval {
    requestId: string;
    digest: string;
    briefs: { workId: string; title: string; brief: string; previousBrief?: string; approvalDigest: string }[];
}

/**
 * Requests approval as it opens and shows the brief the server returned, which its request ID and digest cover, so one
 * click approves the displayed text. A group shows its parts' briefs; a single item shows its brief in place of the
 * record body, given as `body` for while the request loads or after it fails.
 */
export function ApproveBrief({
    itemId,
    workIds,
    body,
    onApproved,
}: {
    itemId: string;
    workIds?: string[];
    body?: ReactNode;
    onApproved?: () => Promise<unknown>;
}) {
    const [approval, setApproval] = useState<Approval>();
    const [loadError, setLoadError] = useState<string | null>();
    const [requesting, setRequesting] = useState(false);
    const [note, setNote] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>();
    // Only the latest request's response is shown, so a superseded one never replaces the request ID and digest.
    const latest = useRef(0);

    async function inspect() {
        const request = ++latest.current;

        // A new request starts unspent, even after an earlier one was accepted.
        setPending(false);
        setApproval(undefined);
        setLoadError(null);

        const result = await postAction<{ approval: Approval }>('/api/inspect-brief', {
            itemId,
            ...(workIds && { workIds }),
        });

        if (request !== latest.current) return;

        receive(result);
        setLoadError(result.error);
        setApproval(result.approval);
    }

    // The parts array is rebuilt on every render; their sorted IDs change only when the set does.
    const shown = workIds ? workIds.toSorted().join(' ') : itemId;
    // StrictMode starts an effect twice, and one request answers for both.
    const opened = useRef<string | null>(null);

    const inspectOpened = useEffectEvent(() => {
        if (opened.current === shown) return;

        opened.current = shown;
        void inspect();
    });

    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect -- another item or set of parts clears the last approval as its request starts
        inspectOpened();
    }, [shown]);

    /** A rejected request ID or digest is spent, so a rejection fetches a new approval request with the current brief. */
    const send = async (path: string, extra: object = {}) => {
        if (!approval) return;

        setPending(true);
        setError(null);

        const result = await postAction(path, {
            itemId,
            requestId: approval.requestId,
            digest: approval.digest,
            ...extra,
        });

        receive(result);
        setError(result.error);

        if (result.error) return void inspect();

        // The request is spent: the controls stay disabled until the refresh replaces this dialog's record.
        setRequesting(false);
        setNote('');
        for (const id of workIds ?? [itemId]) forgetItemDetails(id);
        await onApproved?.();
    };

    const ready = Boolean(approval) && !pending;

    return (
        <Stack space="tight">
            {error && <Alert tone="danger">{error}</Alert>}
            {loadError && (
                <Alert tone="danger">
                    <Stack space="tight">
                        <Text>{loadError}</Text>
                        <Inline wrap>
                            <Button {...buttonKind('other')} onClick={() => void inspect()}>
                                Retry
                            </Button>
                        </Inline>
                    </Stack>
                </Alert>
            )}
            <Inline wrap>
                <Button {...buttonKind('main')} disabled={!ready} onClick={() => void send('/api/approve-brief')}>
                    {workIds && workIds.length > 1 ? 'Approve briefs' : 'Approve brief'}
                </Button>
                <Button {...buttonKind('other')} disabled={!ready} onClick={() => setRequesting(!requesting)}>
                    Request changes
                </Button>
            </Inline>
            {requesting && (
                <BriefChanges
                    note={note}
                    onNote={setNote}
                    pending={!ready}
                    onSubmit={() => void send('/api/request-brief-changes', { note })}
                />
            )}
            {approval ? (
                <Disclosure label="Brief to approve" presentation="section" defaultOpen>
                    {approval.briefs.map((brief) => (
                        <Stack key={brief.workId} space="tight">
                            {workIds && <Text>{brief.title}</Text>}
                            {brief.previousBrief && <BriefRevision before={brief.previousBrief} after={brief.brief} />}
                            {brief.previousBrief && <Text>Complete proposed brief</Text>}
                            {workIds ? (
                                <RichText text={briefProse(brief.brief)} format="markdown" />
                            ) : (
                                <MarkdownDiagrams text={briefProse(brief.brief)} />
                            )}
                        </Stack>
                    ))}
                </Disclosure>
            ) : (
                body
            )}
            {approval ? (
                <BriefApprovalDetails briefs={approval.briefs} digest={approval.digest} />
            ) : (
                !loadError && (
                    <Text variant="caption" tone="muted" role="status">
                        Fetching the brief to approve.
                    </Text>
                )
            )}
        </Stack>
    );
}
