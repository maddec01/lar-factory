// The ticket picker: searches one repository's open tickets through /api/tickets by words or a number, and lists the
// matches to pick one. A ticket already on the board says so. Add item picks a ticket into a work record with it, and
// the item dialog attaches one to captured work.

import { repoName, type TicketMatch } from '@lar-factory/shared';
import { Button, EmptyState } from '@lar-works/design-system';
import { SearchIcon } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { useBoardStore } from '@/services/board/board.hooks';
import { searchTickets } from '@/services/tickets/tickets.service';
import { TicketSearch } from '@/ui/board';

type Phase = 'idle' | 'searching' | 'found' | 'picking';

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
    const repos = useBoardStore((state) => state.data.repos);
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
            setMessage(found.length ? '' : 'Nothing matches');
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
        <>
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
            {phase === 'idle' && repo && (
                <EmptyState
                    size="inline"
                    icon={<SearchIcon />}
                    title="Find an open ticket"
                    description={`Search ${repoName(repo, repos)}’s tickets by title or #number.`}
                />
            )}
            {message === 'Nothing matches' && (
                <Button
                    variant="secondary"
                    onClick={() => {
                        setQuery('');
                        setMessage('');
                        setPhase('idle');
                    }}
                >
                    Clear search
                </Button>
            )}
        </>
    );
}
