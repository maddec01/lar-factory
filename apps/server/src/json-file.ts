// Reads the JSON files T3 Code keeps, each an object, failing soft.

import { readFileSync } from 'node:fs';
import { isRecord } from '@mux-factory/shared';

/** The object a JSON file holds, or null when it is missing, garbled or not an object. */
export function readJsonRecord(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
