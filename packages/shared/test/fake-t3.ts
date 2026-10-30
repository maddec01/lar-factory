// A fake T3 Code for install-targets tests: its `t3` CLI's `auth session issue` and `revoke`, its runtime file, and a
// server that answers `/api/auth/websocket-ticket/rpc` and `server.getConfig` over `/ws` the way T3's does.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import type { T3Run } from '../src/install-targets.ts';

export interface FakeT3Options {
  /** `server.getConfig`'s answer. */
  config: unknown;
  /** Rejects the bearer token when true, as T3 does for a revoked or expired session. */
  rejectToken?: boolean;
  /** Never answers `server.getConfig` when true. */
  hang?: boolean;
  /** Sends a text frame that isn't JSON before its answer when true. */
  garbage?: boolean;
  /** Answers the ticket request with a redirect to this URL. */
  redirectTo?: string;
}

export interface FakeT3 {
  /** The runtime file naming the fake server's origin. */
  runtimePath: string;
  /** The fake `t3` CLI. */
  runT3: T3Run;
  /** Session ids revoked through the CLI. */
  revoked: string[];
  /** Every `t3` call's arguments. */
  calls: string[][];
}

const TOKEN = 'fake-bearer-token';
const TICKET = 'fake-ws-ticket';
const SESSION = 'fake-session-id';

/** Starts a fake T3 in `dir`, closed when the test ends through `onClose`. */
export async function startFakeT3(dir: string, options: FakeT3Options, onClose: (close: () => void) => void): Promise<FakeT3> {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/auth/websocket-ticket/rpc') {
      if (options.redirectTo) {
        response.writeHead(307, { location: options.redirectTo }).end();
        return;
      }
      if (options.rejectToken || request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"code":"auth_invalid"}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ticket: TICKET, expiresAt: '2099-01-01T00:00:00Z' }));
      return;
    }
    response.writeHead(404).end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || url.searchParams.get('orchestrationProtocol') !== '2' || url.searchParams.get('wsTicket') !== TICKET) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', (data: Buffer) => {
      const text = readTextFrame(data);
      if (text === undefined) return;
      const message = JSON.parse(text) as { _tag?: string; id?: string; tag?: string };
      if (message._tag !== 'Request' || message.tag !== 'server.getConfig' || options.hang) return;
      if (options.garbage) socket.write(textFrame('not json'));
      socket.write(textFrame(JSON.stringify({ _tag: 'Exit', requestId: message.id, exit: { _tag: 'Success', value: options.config } })));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const runtimePath = join(dir, 'server-runtime.json');
  writeFileSync(runtimePath, JSON.stringify({ version: 1, pid: process.pid, port, origin: `http://127.0.0.1:${port}` }));
  onClose(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const revoked: string[] = [];
  const calls: string[][] = [];
  const runT3: T3Run = async (args) => {
    calls.push(args);
    if (args[0] === 'auth' && args[1] === 'session' && args[2] === 'issue') {
      return { code: 0, stdout: JSON.stringify({ sessionId: SESSION, token: TOKEN, scopes: ['orchestration:read'] }) };
    }
    if (args[0] === 'auth' && args[1] === 'session' && args[2] === 'revoke' && args[3]) {
      revoked.push(args[3]);
      return { code: 0, stdout: '' };
    }
    return { code: 1, stdout: '' };
  };
  return { runtimePath, runT3, revoked, calls };
}

/** A client frame's text: a single masked text frame, as Node's WebSocket sends a short message. */
function readTextFrame(data: Buffer): string | undefined {
  if ((data[0]! & 0x0f) !== 1) return undefined;
  let length = data[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = data.readUInt16BE(2);
    offset = 4;
  }
  const mask = data.subarray(offset, offset + 4);
  const payload = data.subarray(offset + 4, offset + 4 + length);
  return Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]!)).toString('utf8');
}

/** An unmasked server text frame holding `text`. */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}
