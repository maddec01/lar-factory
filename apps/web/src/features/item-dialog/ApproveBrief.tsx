import { Alert, Button, Disclosure, Inline, RichText, Stack, Text } from '@lar-works/design-system';
import { useState } from 'react';

import { postAction, receive } from '@/services/board/board.service';
import { forgetItemDetails } from '@/services/items/items.hooks';
import { BriefApprovalDetails, BriefChanges, buttonKind } from '@/ui/board';

interface Approval {
    requestId: string;
    digest: string;
    briefs: { workId: string; title: string; brief: string; approvalDigest: string }[];
}

/** Approval is a separate human action after the board displays the complete current brief. */
export function ApproveBrief({
    itemId,
    workIds,
    onApproved,
}: {
    itemId: string;
    workIds?: string[];
    onApproved?: () => Promise<unknown>;
}) {
    const [approval, setApproval] = useState<Approval>();
    const [requesting, setRequesting] = useState(false);
    const [note, setNote] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>();
    const act = async () => {
        setPending(true);

        const result = approval
            ? await postAction('/api/approve-brief', { itemId, requestId: approval.requestId, digest: approval.digest })
            : await postAction<{ approval: Approval }>('/api/inspect-brief', { itemId, ...(workIds && { workIds }) });

        receive(result);
        setError(result.error);

        if (approval) {
            setApproval(undefined);

            if (!result.error) {
                for (const id of workIds ?? [itemId]) forgetItemDetails(id);
                await onApproved?.();
            }
        } else setApproval('approval' in result ? (result.approval as Approval) : undefined);

        setPending(false);
    };

    const requestChanges = async () => {
        if (!approval || pending || !note.trim()) return;

        setPending(true);

        const result = await postAction('/api/request-brief-changes', {
            itemId,
            requestId: approval.requestId,
            digest: approval.digest,
            note,
        });

        receive(result);
        setError(result.error);

        if (!result.error) {
            setApproval(undefined);
            setRequesting(false);
            setNote('');
            for (const id of workIds ?? [itemId]) forgetItemDetails(id);
            await onApproved?.();
        }

        setPending(false);
    };

    return (
        <Stack space="tight">
            {error && <Alert tone="danger">{error}</Alert>}
            <Inline wrap>
                <Button {...buttonKind('main')} disabled={pending} onClick={() => void act()}>
                    {approval
                        ? 'Approve displayed brief'
                        : workIds && workIds.length > 1
                          ? 'Approve briefs'
                          : 'Approve brief'}
                </Button>
                {approval && (
                    <Button {...buttonKind('other')} disabled={pending} onClick={() => setRequesting(!requesting)}>
                        Request changes
                    </Button>
                )}
            </Inline>
            {approval && requesting && (
                <BriefChanges note={note} onNote={setNote} pending={pending} onSubmit={() => void requestChanges()} />
            )}
            {approval && (
                <>
                    <Disclosure label="Brief to approve" presentation="section" defaultOpen>
                        {approval.briefs.map((brief) => (
                            <Stack key={brief.workId} space="tight">
                                <Text>{brief.title}</Text>
                                <RichText text={brief.brief} format="markdown" />
                            </Stack>
                        ))}
                    </Disclosure>
                    <BriefApprovalDetails briefs={approval.briefs} digest={approval.digest} />
                </>
            )}
        </Stack>
    );
}
