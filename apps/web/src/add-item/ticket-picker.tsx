// The ticket picker: searches one repository's open tickets through /api/tickets by words or a number, and lists the
// matches to pick one. A ticket already on the board says so. Add item picks a ticket into a work record with it, and
// the item dialog attaches one to captured work.

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TicketMatch } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { kind } from '../buttons/button-kinds.tsx';
import { FormResult } from '../notices/form-result.tsx';

type Phase = 'idle' | 'searching' | 'found' | 'picking';

/** Reads the repository's open tickets matching `query`: the matches, or the error to show. */
async function searchTickets(repo: string, query: string): Promise<TicketMatch[] | string> {
  try {
    const response = await fetch(`/api/tickets?${new URLSearchParams({ repo, q: query })}`);
    const result = await response.json() as { tickets?: TicketMatch[]; error?: string | null };
    return result.tickets ?? result.error ?? `Request failed (HTTP ${response.status}).`;
  } catch {
    return "Can't reach the board server. Try again.";
  }
}

/**
 * The search field, its Search button and the matches, each a button that runs `onPick`, which resolves with the
 * error to show, or null. `id` prefixes the field's ids. Remount it with a key per repository, so another starts clear.
 */
export function TicketPicker({ id, repo, disabled, onPick }: { id: string; repo: string; disabled?: boolean;
  onPick: (ticket: TicketMatch) => Promise<string | null> }) {
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
  const pick = async (ticket: TicketMatch) => {
    setPhase('picking');
    setMessage('');
    const error = await onPick(ticket);
    setPhase('found');
    if (error) setMessage(error);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search();
  };

  return (
    <div className="grid gap-2" data-ticket-picker>
      <div className="flex gap-2">
        <input id={`${id}-query`} type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={onKey}
          disabled={disabled} autoComplete="off" aria-label="Search open tickets" placeholder="Words from the title, or #12"
          className="h-8 min-w-0 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        <Button {...kind('other')} id={`${id}-search`} disabled={disabled || busy} onClick={() => void search()}>Search</Button>
      </div>
      {tickets.length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 p-0" aria-label="Open tickets" aria-busy={phase === 'picking'}>
          {tickets.map((ticket) => (
            <li key={ticket.number}>
              <button type="button" data-ticket={ticket.number} disabled={busy} onClick={() => void pick(ticket)}
                className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-base-200/70 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">
                <span className="shrink-0 tabular-nums text-(--muted-foreground)">#{ticket.number}</span>
                <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                {ticket.workId && <span className="shrink-0 text-xs text-(--muted-foreground)">Already added</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <FormResult id={`${id}-result`} text={message} />
    </div>
  );
}
