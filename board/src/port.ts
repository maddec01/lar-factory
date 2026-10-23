// Picks the board's port the way T3 Code does: the first free one in a fixed range.

import type { Server } from 'node:net';

/** The ports a board without BOARD_PORT tries, in order. The board app's board takes the first, 4317. */
export const BOARD_PORTS: readonly number[] = Array.from({ length: 100 }, (_, i) => 4317 + i);

/** Listens on the first of `ports` that isn't in use and returns it; null when every one is. */
export async function listenOnFreePort(server: Server, host: string, ports: readonly number[]): Promise<number | null> {
  for (const port of ports) {
    if (await listen(server, host, port)) return port;
  }
  return null;
}

/** What a board sends the process that started it with an IPC channel, such as the board app. */
export type ParentMessage = { type: 'listening'; port: number };

/** Tells the parent process, when there is one with an IPC channel, that the board listens on `port`. */
export function reportListening(port: number): void {
  if (!process.send || !process.connected) return;
  const message: ParentMessage = { type: 'listening', port };
  process.send(message);
}

function listen(server: Server, host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) => {
      server.off('listening', listening);
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    };
    const listening = () => {
      server.off('error', failed);
      resolve(true);
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, host);
  });
}
