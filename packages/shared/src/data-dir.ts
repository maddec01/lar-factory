// The factory's data folder, where the board server and the work-records command both keep their files.

import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * The absolute data folder the lar-work launcher names, so a thread whose agent runs with another HOME still opens the
 * board's database.
 */
export const DATA_DIR_ENV = 'LAR_FACTORY_DATA_DIR';

/**
 * The board server's data folder, which holds its board records, its armed starts and the work-record database: in
 * `home` when given, else the absolute folder `env` names in DATA_DIR_ENV, else in `env`'s HOME.
 */
export function boardDataDir(home?: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env[DATA_DIR_ENV];
  if (home === undefined && named && isAbsolute(named)) return named;
  return join(home ?? (env.HOME || homedir()), 'Library/Application Support/Lar Factory');
}
