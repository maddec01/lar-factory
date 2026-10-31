import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { readRetention, writeRetention } from './retention.ts';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'retention-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('retention setting', () => {
  it('keeps records and hides them after seven days until the machine chooses otherwise', () => {
    expect(readRetention(tempDir())).toEqual({ hideAfterDays: 7, deleteAfterDays: null });
  });

  it('saves a deletion choice in the data folder and reads it back', () => {
    const dir = join(tempDir(), 'Lar Factory');
    expect(writeRetention({ hideAfterDays: 7, deleteAfterDays: 30 }, dir)).toEqual({ hideAfterDays: 7, deleteAfterDays: 30 });
    expect(readRetention(dir)).toEqual({ hideAfterDays: 7, deleteAfterDays: 30 });
    expect(readdirSync(dir)).toEqual(['retention.json']);
  });

  it('refuses a malformed setting and leaves the saved one as it was', () => {
    const dir = tempDir();
    writeRetention({ hideAfterDays: 3, deleteAfterDays: null }, dir);
    expect(() => writeRetention({ hideAfterDays: -1, deleteAfterDays: null }, dir)).toThrow('whole numbers of days');
    expect(() => writeRetention({ hideAfterDays: 7, deleteAfterDays: 1.5 }, dir)).toThrow('whole numbers of days');
    expect(readRetention(dir)).toEqual({ hideAfterDays: 3, deleteAfterDays: null });
    writeFileSync(join(dir, 'retention.json'), '{');
    expect(() => readRetention(dir)).toThrow("isn't JSON");
  });
});
