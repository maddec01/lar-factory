import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonRecord } from './json-file.ts';
import { tempDir } from '../test/stats-db.ts';

test('a JSON file reads as its object, and as null when missing, garbled or not an object', (t) => {
  const dir = tempDir(t, 'mux-json-');
  const file = (name: string, text: string) => {
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  assert.deepEqual(readJsonRecord(file('object.json', '{"a":1}')), { a: 1 });
  assert.equal(readJsonRecord(join(dir, 'missing.json')), null);
  assert.equal(readJsonRecord(file('garbled.json', '{')), null);
  assert.equal(readJsonRecord(file('array.json', '[1]')), null);
  assert.equal(readJsonRecord(file('null.json', 'null')), null);
});
