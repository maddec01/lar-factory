import { writeAccessProblem, type Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
// Local work previews its authoritative outgoing text and reuses Add item's provider options.
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useCreateTicketStore, type TicketPreview } from './CreateTicketStore';
import { TicketOptionFields, ticketOptions } from '@/features/add-item/IssueFields';
import { useEditStore } from '@/features/repositories/EditStore';
import { useBoardStore } from '@/services/board/board.hooks';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

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
                {...kind('other')}
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
        <section
            ref={section}
            tabIndex={-1}
            aria-label="Create issue"
            className="grid max-h-[50dvh] w-full gap-3 overflow-y-auto pt-1"
        >
            {reason && (
                <div role="status">
                    <p>{reason}</p>
                    <Button {...kind('other')} onClick={() => void useEditStore.getState().recheck(item.repo)}>
                        Recheck access
                    </Button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
            {!outgoing && !error && <p role="status">Reading outgoing issue text…</p>}
            {!outgoing && (
                <Button {...kind('other')} className="justify-self-start" onClick={() => setOpen(false)}>
                    Cancel
                </Button>
            )}
            {outgoing && (
                <form className="grid gap-3" onSubmit={onSubmit} aria-busy={attempt?.phase === 'pending'}>
                    <div aria-label="Outgoing title" className="font-medium wrap-anywhere">
                        {outgoing.title}
                    </div>
                    <pre
                        aria-label="Outgoing text"
                        className="m-0 max-h-64 overflow-auto text-xs wrap-anywhere whitespace-pre-wrap"
                    >
                        {outgoing.description}
                    </pre>
                    <fieldset disabled={locked || !!reason} className="m-0 grid min-w-0 gap-3 border-0 p-0">
                        <legend className="sr-only">Issue options</legend>
                        {!reason && <TicketOptionFields repo={repo} kind={item.kind} kept={attempt?.options} />}
                    </fieldset>
                    {attempt?.message && (
                        <p role={attempt.phase === 'failed' || attempt.phase === 'uncertain' ? 'alert' : 'status'}>
                            {attempt.message}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button {...kind('other')} onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            {...kind('main')}
                            type="submit"
                            disabled={!!reason || attempt?.phase === 'pending' || attempt?.phase === 'uncertain'}
                        >
                            {attempt?.phase === 'pending'
                                ? 'Creating…'
                                : attempt?.phase === 'retry'
                                  ? 'Retry this submission'
                                  : 'Create issue'}
                        </Button>
                    </div>
                </form>
            )}
        </section>
    );
}
