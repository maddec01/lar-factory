// The ticket picker: searches one repository's open tickets through /api/tickets by words or a number, and lists the
// matches to pick one. A ticket already on the board says so. Add item picks a ticket into a work record with it, and
// the item dialog attaches one to captured work.

import type { TicketMatch } from '@lar-factory/shared';
import { TicketSearch } from '@lar-works/design-system';
import { useState } from 'react';

type Phase = 'idle' | 'searching' | 'found' | 'picking';

/** Reads the repository's open tickets matching `query`: the matches, or the error to show. */
async function searchTickets(repo: string, query: string): Promise<TicketMatch[] | string> {
    try {
        const response = await fetch(`/api/tickets?${new URLSearchParams({ repo, q: query })}`);
        const result = (await response.json()) as { tickets?: TicketMatch[]; error?: string | null };

        return result.tickets ?? result.error ?? `Request failed (HTTP ${response.status}).`;
    } catch {
        return "Can't reach the board server. Try again.";
    }
}

/**
 * The search field, its Search button and the matches, each a button that runs `onPick`, which resolves with the
 * error to show, or null. `id` prefixes the field's ids. Remount it with a key per repository, so another starts clear.
 */
export function TicketPicker({
    id,
    repo,
    disabled,
    onPick,
}: {
    id: string;
    repo: string;
    disabled?: boolean;
    onPick: (ticket: TicketMatch) => Promise<string | null>;
}) {
    const [query, setQuery] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [tickets, setTickets] = useState<TicketMatch[]>([]);
    const [message, setMessage] = useState('');
    const busy = phase === 'searching' || phase === 'picking';

    const search = async () => {
        if (busy || disabled) return;

        setPhase('searching');
        setMessage('Searching…');

        const found = await searchTickets(repo, query);

        setPhase('found');

        if (typeof found === 'string') {
            setTickets([]);
            setMessage(found);
        } else {
            setTickets(found);
            setMessage(found.length ? '' : 'No open ticket matches.');
        }
    };
    const pick = async (number: number) => {
        const ticket = tickets.find((match) => match.number === number);

        if (!ticket) return;

        setPhase('picking');
        setMessage('');

        const error = await onPick(ticket);

        setPhase('found');

        if (error) setMessage(error);
    };

    return (
        <TicketSearch
            id={id}
            query={query}
            onQueryChange={setQuery}
            onSearch={() => void search()}
            fieldLabel="Search open tickets"
            placeholder="Words from the title, or #12"
            searchLabel="Search"
            disabled={disabled}
            searchDisabled={disabled || busy}
            tickets={tickets.map((ticket) => ({
                number: ticket.number,
                title: ticket.title,
                note: ticket.workId ? 'Already added' : undefined,
            }))}
            listLabel="Open tickets"
            busy={busy}
            picking={phase === 'picking'}
            onPick={(number) => void pick(number)}
            result={message}
        />
    );
}
