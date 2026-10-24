// Each live board records its port under the user's Application Support, so
// status.sh can find every running board whatever port it took.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The folder of board records, one `<pid>.json` holding `{ "port": n }` per live board. */
function boardRecordsDir(home = process.env.HOME || homedir()): string {
  return join(home, 'Library/Application Support/Mux Factory/boards');
}

/** Records this process's board on `port` and returns a function that removes the record. */
export function recordBoard(port: number, dir = boardRecordsDir()): () => void {
  const file = join(dir, `${process.pid}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ port }));
  return () => rmSync(file, { force: true });
}
