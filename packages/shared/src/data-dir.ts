// The factory's data folder, where the board server and the work-records command both keep their files.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The board server's data folder, which holds its board records, its armed starts and the work-record database. */
export function boardDataDir(home = process.env.HOME || homedir()): string {
  return join(home, 'Library/Application Support/Lar Factory');
}
