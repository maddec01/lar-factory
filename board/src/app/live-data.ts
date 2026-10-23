// Keeps the board data live: the server pushes it over /api/events, and while that stream is
// down the page fetches /api/board every 15 s, or every second while an update runs.

import { useBoardStore } from './board-store.ts';
import { useDismissStore } from './dismiss-store.ts';
import { holdAnchor } from './keep-anchor.ts';
import type { BoardData } from '../model.ts';

const POLL_MS = 15_000;
const UPDATE_POLL_MS = 1_000;
/** The key of the banner that says the page can't reach the server. */
export const CLIENT_ERROR = 'client-error';

export function startLiveData(): void {
  const board = useBoardStore.getState();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  /** Whether the server's event stream is open; the page then stops polling. */
  let streaming = false;

  const receive = (text: string) => {
    holdAnchor();
    board.receive(JSON.parse(text) as BoardData);
    // The server answered: if it goes away again, say so even if the last banner was closed.
    useDismissStore.getState().restore(CLIENT_ERROR);
  };

  function schedule(): void {
    clearTimeout(timer);
    // The stream drops while an update restarts the board, so an update is always polled.
    if (useBoardStore.getState().data.update?.state === 'running') timer = setTimeout(() => void poll(), UPDATE_POLL_MS);
    // A silent stream sends no new data; the clock still moves on, so stale data shows as stale.
    else if (streaming) timer = setTimeout(() => { board.tick(); schedule(); }, POLL_MS);
    else timer = setTimeout(() => void poll(), POLL_MS);
  }

  async function poll(): Promise<void> {
    const current = ++sequence;
    const writes = useBoardStore.getState().writes;
    // A write this page made meanwhile brought newer data than this poll's.
    const fresh = () => current === sequence && writes === useBoardStore.getState().writes;
    try {
      const res = await fetch('/api/board', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (fresh()) receive(text);
    } catch (err) {
      if (fresh()) board.fail(err instanceof Error ? err.message : String(err));
    } finally {
      if (current === sequence) schedule();
    }
  }

  /** The browser reconnects a dropped stream by itself, but not a refused one. */
  function openStream(): void {
    const source = new EventSource('/api/events');
    source.onopen = () => {
      streaming = true;
      schedule();
    };
    source.onmessage = (event: MessageEvent<string>) => {
      // A push is the newest data: drop any poll still in flight.
      ++sequence;
      receive(event.data);
      schedule();
    };
    source.onerror = () => {
      // Fires on each failed reconnect too; only the first may restart the poll clock.
      if (streaming) {
        streaming = false;
        schedule();
      }
      if (source.readyState === EventSource.CLOSED) setTimeout(openStream, POLL_MS);
    };
  }

  schedule();
  openStream();
}
