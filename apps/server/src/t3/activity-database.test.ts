import { renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';
import { tempDir } from '../../test/stats-db.ts';
import { createActivityDatabase } from './activity-database.ts';

function seed(path: string, value: number) {
  const writer = new DatabaseSync(path);
  writer.exec(`CREATE TABLE facts (value INTEGER); INSERT INTO facts VALUES (${value})`);
  writer.close();
}
const value = (db: DatabaseSync) => db.prepare('SELECT value FROM facts').get()!.value;

test('reusing the connection sees commits from T3 immediately, without keeping a read transaction', (t) => {
  const path = join(tempDir(t, 'activity-db-'), 'state.sqlite');
  seed(path, 1);
  const writer = new DatabaseSync(path);
  writer.exec('PRAGMA journal_mode=WAL');
  const database = createActivityDatabase(path);
  t.onTestFinished(() => { database.close(); writer.close(); });
  const first = database.open();
  expect(value(first)).toBe(1);
  database.release(first, false);
  writer.exec('UPDATE facts SET value = 2');
  expect(database.open()).toBe(first);
  expect(value(database.open())).toBe(2);
});

test('a replaced or removed database closes the old connection before the next read', (t) => {
  const dir = tempDir(t, 'activity-replaced-');
  const path = join(dir, 'state.sqlite');
  const replacement = join(dir, 'replacement.sqlite');
  seed(path, 1);
  seed(replacement, 2);
  const database = createActivityDatabase(path);
  t.onTestFinished(database.close);
  const first = database.open();
  expect(value(first)).toBe(1);
  renameSync(replacement, path);
  const second = database.open();
  expect(second === first).toBe(false);
  expect(value(second)).toBe(2);
  expect(() => value(first)).toThrow();
  rmSync(path);
  expect(() => database.open()).toThrow();
  expect(() => value(second)).toThrow();
  seed(path, 3);
  expect(value(database.open())).toBe(3);
});

test('a failed activity pass drops its connection and a missing database can recover', (t) => {
  const path = join(tempDir(t, 'activity-recover-'), 'state.sqlite');
  const database = createActivityDatabase(path);
  t.onTestFinished(database.close);
  expect(() => database.open()).toThrow();
  seed(path, 1);
  const first = database.open();
  database.release(first, true);
  expect(() => value(first)).toThrow();
  const next = database.open();
  expect(next === first).toBe(false);
  // A late release of the previous connection must not close the replacement.
  database.release(first, true);
  expect(value(next)).toBe(1);
  database.release(undefined, false);
  expect(() => value(next)).toThrow();
  database.close();
  database.close();
});
