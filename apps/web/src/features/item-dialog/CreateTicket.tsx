import { onAzure, writeAccessProblem, type Item } from '@lar-factory/shared';
import { Button, FormFieldset, Inline, Loading, Stack, Text } from '@lar-works/design-system';
// Local work previews its authoritative outgoing text and reuses Add item's provider options.
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';

import { useCreateTicketStore } from './CreateTicketStore';
import { TicketOptionFields, ticketOptions } from '@/features/add-item';
import { useEditStore } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { readTicketPreview, type TicketPreview } from '@/services/tickets/tickets.service';
import { AccessNotice, ActionError, buttonKind, FocusPanel, OutgoingTicket, RetryAction } from '@/ui/board';

export function CreateTicket({ item }: { item: Item }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const section = useRef<HTMLElement>(null);
    // The outgoing text read for an item, or why it couldn't be; a read for another item doesn't show.
    const [read, setRead] = useState<{ itemId: string; preview?: TicketPreview; error?: string } | null>(null);
    const preview = (read?.itemId === item.id && read.preview) || null;
    const error = (read?.itemId === item.id && read.error) || '';
    const data = useBoardStore((state) => state.data);
    const attempt = useCreateTicketStore((state) => state.attempts[item.id]);
    const submit = useCreateTicketStore((state) => state.submit);
    const repo = data.repos.find((repo) => repo.repo === item.repo);
    const reason = writeAccessProblem(item.repo, 'publish-ticket', repo?.setup?.access ?? {}, {
        azureReadOnly: repo?.setup?.azureReadOnly,
        recheckAction: true,
    });
    const locked = !!attempt && attempt.phase !== 'failed';

    const restoreFocus = useEffectEvent(() => trigger.current?.focus());

    useEffect(() => {
        if (!open) return;

        section.current?.focus();

        const itemId = item.id;
        const shown = new AbortController();

        void readTicketPreview(itemId)
            .then((preview) => {
                if (!shown.signal.aborted) setRead({ itemId, preview });
            })
            .catch(() => {
                if (!shown.signal.aborted)
                    setRead({
                        itemId,
                        error: 'Couldn’t load the outgoing issue text. Close and reopen Create issue to try again.',
                    });
            });

        return () => {
            shown.abort();
            restoreFocus();
        };
    }, [open, item.id]);

    if (item.number || !repo || data.capture?.enabled === false) return null;

    if (!open)
        return (
            <Button
                ref={trigger}
                // A quiet control, as the sidebar's other properties are values, not calls to act.
                {...buttonKind('control')}
                data-create-ticket={item.id}
                title={
                    item.repo && onAzure(item.repo) ? 'Create a work item in Azure DevOps' : 'Create an issue on GitHub'
                }
                onClick={() => {
                    setRead(null);
                    setOpen(true);
                }}
            >
                Create
            </Button>
        );

    const outgoing = locked ? attempt.preview : preview;
    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (outgoing) void submit(item.id, outgoing, ticketOptions(event.currentTarget));
    };

    return (
        <FocusPanel ref={section} label="Create issue">
            {reason && (
                <AccessNotice
                    message={reason}
                    action={<RetryAction access onRetry={() => void useEditStore.getState().recheck(item.repo)} />}
                />
            )}
            {error && <ActionError>{error}</ActionError>}
            {!outgoing && !error && <Loading presentation="status" label="Loading the outgoing issue text…" />}
            {!outgoing && (
                <Inline as="span">
                    <Button {...buttonKind('other', { size: 'md' })} onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                </Inline>
            )}
            {outgoing && (
                <Stack as="form" onSubmit={onSubmit} aria-busy={attempt?.phase === 'pending'}>
                    <OutgoingTicket
                        title={outgoing.title}
                        text={outgoing.description}
                        titleLabel="Outgoing title"
                        textLabel="Outgoing text"
                    />
                    <FormFieldset
                        presentation="group"
                        disabled={locked || !!reason}
                        legend="Issue options"
                        hiddenLegend
                    >
                        {!reason && <TicketOptionFields repo={repo} kind={item.kind} kept={attempt?.options} />}
                    </FormFieldset>
                    {attempt?.message && (
                        <Text
                            variant="inherit"
                            role={attempt.phase === 'failed' || attempt.phase === 'uncertain' ? 'alert' : 'status'}
                        >
                            {attempt.message}
                        </Text>
                    )}
                    <Inline as="span">
                        <Button {...buttonKind('other', { size: 'md' })} onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            {...buttonKind('main', { size: 'md' })}
                            type="submit"
                            disabled={!!reason || attempt?.phase === 'pending' || attempt?.phase === 'uncertain'}
                        >
                            {attempt?.phase === 'pending'
                                ? 'Creating…'
                                : attempt?.phase === 'retry'
                                  ? 'Retry this submission'
                                  : 'Create issue'}
                        </Button>
                    </Inline>
                </Stack>
            )}
        </FocusPanel>
    );
}
