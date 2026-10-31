import { isRecord } from '@lar-factory/shared';
import { ShellRecovery } from './shell-recovery.ts';
import { type ProjectProtocol, type ProjectRead } from './project-protocol.ts';

/** T3 97e35bcf23e4dcf34c2dcffadd37c08db0e01e52:
 * apps/server/src/ws.ts:1158-1200,3277-3337; packages/client-runtime/src/rpc/protocol.ts.
 * Reconnect requests a fresh snapshot, never a partial replay.
 * Exercised on nightly 3917, port 3773, 2026-10-31: eight projects, forced
 * disconnect with retained observation, fresh-ticket reconnect to eight projects.
 * Renewal and rejection failures use fixtures. Consumer migration is #706.
 */
export function subscribeProjects(origin: URL, _serverVersion: string, protocol: ProjectProtocol,
  onChange: (read: ProjectRead) => void,
  execution?: { tag: string; payload: Record<string, unknown>; accept(value: unknown): void }): () => void {
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password) throw new Error('Expected local T3 server');
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let observation: ProjectRead['observation'];
  let failures = 0;
  let ticketRequest: AbortController | undefined;
  const publish = (availability: ProjectRead['availability']) => onChange({ availability, ...(observation ? { observation } : {}) });
  const connect = async () => {
    if (stopped) return;
    let availability: ProjectRead['availability'] = 'unavailable';
    let current: WebSocket | undefined;
    const disconnected = () => {
      if (current && socket !== current) return;
      socket = undefined;
      if (heartbeat) clearInterval(heartbeat);
      if (renewal) clearTimeout(renewal);
      current?.close();
      if (!stopped && !retry) {
        publish(availability);
        retry = setTimeout(() => { retry = undefined; void connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
      }
    };
    try {
      let token: string;
      try {
        const session = await protocol.subscriptionSession();
        token = session.token;
        renewal = setTimeout(() => {
          if (stopped) return;
          socket = undefined;
          if (heartbeat) clearInterval(heartbeat);
          current?.close();
          void connect();
        }, Math.min(2_147_483_647, Math.max(1, Date.parse(session.expiresAt) - Date.now() - 60_000)));
      }
      catch { availability = 'renewal-required'; throw Error(); }
      if (stopped) return;
      ticketRequest = new AbortController();
      const response = await fetch(new URL('/api/auth/websocket-ticket/rpc', origin), {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.any([ticketRequest.signal, AbortSignal.timeout(10_000)]),
      });
      if (response.status === 401 || response.status === 403) availability = 'renewal-required';
      if (!response.ok) throw Error();
      const ticket: unknown = await response.json();
      if (!isRecord(ticket) || typeof ticket.ticket !== 'string' || !ticket.ticket) throw Error();
      if (stopped) return;
      const url = new URL('/ws', origin);
      url.protocol = 'ws:';
      url.searchParams.set('orchestrationProtocol', '2');
      url.searchParams.set('wsTicket', ticket.ticket);
      current = new WebSocket(url);
      socket = current;
      const ws = current;
      const recovery = new ShellRecovery();
      let lastPong = Date.now();
      const send = (value: unknown) => ws.send(JSON.stringify(value));
      ws.addEventListener('open', () => {
        if (stopped) { ws.close(); return; }
        send({ _tag: 'Request', id: '1', tag: execution?.tag ?? 'orchestration.subscribeShell', payload: execution?.payload ?? { requestCompletionMarker: true }, headers: [] });
        send({ _tag: 'Ping' });
      });
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 15_000) disconnected();
        else if (ws.readyState === WebSocket.OPEN) send({ _tag: 'Ping' });
      }, 5000);
      ws.addEventListener('message', event => {
        if (stopped || socket !== ws) return;
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          for (const frame of Array.isArray(parsed) ? parsed : [parsed]) {
            if (!isRecord(frame)) throw Error();
            lastPong = Date.now();
            if (frame._tag === 'Pong') continue;
            else if (frame._tag === 'Chunk' && frame.requestId === '1' && Array.isArray(frame.values)) {
              for (const value of frame.values) if (execution) { execution.accept(value); } else if (recovery.accept(value)) {
                observation = recovery.observation();
                failures = 0;
                publish('available');
              }
              send({ _tag: 'Ack', requestId: '1' });
            } else if (frame._tag === 'Exit') {
              if (execution && isRecord(frame.exit) && frame.exit._tag === 'Success') execution.accept(frame.exit.value);
              else disconnected();
            }
          }
        } catch { availability = 'malformed'; disconnected(); }
      });
      ws.addEventListener('close', disconnected);
      ws.addEventListener('error', disconnected);
    } catch { disconnected(); }
  };
  void connect();
  return () => {
    stopped = true;
    ticketRequest?.abort();
    if (renewal) clearTimeout(renewal);
    if (retry) clearTimeout(retry);
    if (heartbeat) clearInterval(heartbeat);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ _tag: 'Interrupt', requestId: '1' }));
    socket?.close();
    socket = undefined;
  };
}
