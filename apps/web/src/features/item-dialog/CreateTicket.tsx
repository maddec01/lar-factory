import { writeAccessProblem, type Item } from '@lar-factory/shared';
import {
    AccessNotice,
    Button,
    ButtonRow,
    buttonKind,
    FocusPanel,
    FormFieldset,
    OutgoingTicket,
    Stack,
    Text,
} from '@lar-works/design-system';
// Local work previews its authoritative outgoing text and reuses Add item's provider options.
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useCreateTicketStore, type TicketPreview } from './CreateTicketStore';
import { TicketOptionFields, ticketOptions } from '@/features/add-item';
import { useEditStore } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

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
    });
    const locked = !!attempt && attempt.phase !== 'failed';

    useEffect(() => {
        if (!open) return;

        section.current?.focus();

        const itemId = item.id;
        const shown = new AbortController();

        void fetch(`/api/ticket-preview?itemId=${encodeURIComponent(itemId)}`)
            .then(async (response) => {
                const result = (await response.json()) as { preview?: TicketPreview; error?: string };

                if (!response.ok || !result.preview)
                    throw Error(result.error ?? 'Could not read the outgoing issue text.');

                if (!shown.signal.aborted) setRead({ itemId, preview: result.preview });
            })
            .catch(() => {
                if (!shown.signal.aborted)
                    setRead({
                        itemId,
                        error: 'Could not read the outgoing issue text. Close and reopen Create issue to retry.',
                    });
            });

        return () => {
            shown.abort();
            trigger.current?.focus();
        };
    }, [open, item.id]);

    if (item.number || !repo || data.capture?.enabled === false) return null;

    if (!open)
        return (
            <Button
                ref={trigger}
                {...buttonKind('other')}
                data-create-ticket={item.id}
                onClick={() => {
                    setRead(null);
                    setOpen(true);
                }}
            >
                Create issue
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
                    action={
                        <Button
                            {...buttonKind('other')}
                            onClick={() => void useEditStore.getState().recheck(item.repo)}
                        >
                            Recheck access
                        </Button>
                    }
                />
            )}
            {error && (
                <Text variant="inherit" role="alert">
                    {error}
                </Text>
            )}
            {!outgoing && !error && (
                <Text variant="inherit" role="status">
                    Reading outgoing issue text…
                </Text>
            )}
            {!outgoing && (
                <ButtonRow>
                    <Button {...buttonKind('other')} onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                </ButtonRow>
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
                    <ButtonRow>
                        <Button {...buttonKind('other')} onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            {...buttonKind('main')}
                            type="submit"
                            disabled={!!reason || attempt?.phase === 'pending' || attempt?.phase === 'uncertain'}
                        >
                            {attempt?.phase === 'pending'
                                ? 'Creating…'
                                : attempt?.phase === 'retry'
                                  ? 'Retry this submission'
                                  : 'Create issue'}
                        </Button>
                    </ButtonRow>
                </Stack>
            )}
        </FocusPanel>
    );
}
