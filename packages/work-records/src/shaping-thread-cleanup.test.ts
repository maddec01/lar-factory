import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WorkRecordError } from './database.ts';
import { readShapingThreadCleanup, writeShapingThreadCleanup } from './shaping-thread-cleanup.ts';
import type { ShapingThreadCleanup } from '@lar-factory/shared';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'shaping-thread-cleanup-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('shaping thread cleanup setting', () => {
  it('archives until the machine chooses otherwise', () => {
    expect(readShapingThreadCleanup(tempDir())).toBe('archive');
  });

  it.each<ShapingThreadCleanup>(['keep', 'settle', 'archive', 'delete'])('saves %s in the data folder and reads it back', (choice) => {
    const dir = join(tempDir(), 'Lar Factory');
    expect(writeShapingThreadCleanup(choice, dir)).toBe(choice);
    expect(readShapingThreadCleanup(dir)).toBe(choice);
    expect(readdirSync(dir)).toEqual(['shaping-thread-cleanup.json']);
  });

  it('refuses an invalid choice and leaves the saved one as it was', () => {
    const dir = tempDir();
    writeShapingThreadCleanup('settle', dir);
    expect(() => writeShapingThreadCleanup('shred' as ShapingThreadCleanup, dir)).toThrow(WorkRecordError);
    expect(readShapingThreadCleanup(dir)).toBe('settle');
  });

  it('throws on a file it cannot read, and a valid choice replaces that file', () => {
    const dir = tempDir();
    const path = join(dir, 'shaping-thread-cleanup.json');
    writeFileSync(path, '{');
    expect(() => readShapingThreadCleanup(dir)).toThrow("isn't JSON");
    writeFileSync(path, '{ "choice": "shred" }');
    expect(() => readShapingThreadCleanup(dir)).toThrow(WorkRecordError);
    writeFileSync(path, 'null');
    expect(() => readShapingThreadCleanup(dir)).toThrow(WorkRecordError);
    writeShapingThreadCleanup('delete', dir);
    expect(readShapingThreadCleanup(dir)).toBe('delete');
  });
});
