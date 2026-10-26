// Each live board records its port under the user's Application Support, so
// status.sh can find every running board whatever port it took.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The board server's data folder, which holds its board records and its armed starts. */
export function boardDataDir(home = process.env.HOME || homedir()): string {
  return join(home, 'Library/Application Support/Lar Factory');
}

/** Records this process's board on `port` and returns a function that removes the record. The folder holds one
 * `<pid>.json`, `{ "port": n }`, per live board. */
export function recordBoard(port: number, dir = join(boardDataDir(), 'boards')): () => void {
  const file = join(dir, `${process.pid}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ port }));
  return () => rmSync(file, { force: true });
}
