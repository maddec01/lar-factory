import type { HeavyCommandLimit } from '@lar-factory/shared';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { WorkRecordError } from './database.ts';
import { automaticHeavyCommandLimit, readHeavyCommandLimit, writeHeavyCommandLimit } from './heavy-command-limit.ts';

const GB = 2 ** 30;
const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'heavy-command-limit-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('automatic heavy command limit', () => {
    it('gives 10 CPUs and 16 GB 2 slots', () => {
        expect(automaticHeavyCommandLimit(10, 16 * GB)).toBe(2);
    });
});

describe('heavy command limit setting', () => {
    it('saves a limit in the data folder and reads it back', () => {
        const dir = join(tempDir(), 'Lar Factory');

        expect(writeHeavyCommandLimit(1, dir)).toBe(1);
        expect(readHeavyCommandLimit(dir)).toEqual({ limit: 1 });
        expect(readdirSync(dir)).toEqual(['heavy-command-limit.json']);
    });

    it('refuses an invalid limit and leaves the saved one as it was', () => {
        const dir = tempDir();

        writeHeavyCommandLimit(2, dir);
        for (const limit of [0, -1, 1.5, '2', 'auto', null, Infinity]) {
            expect(() => writeHeavyCommandLimit(limit as HeavyCommandLimit, dir), `limit ${String(limit)}`).toThrow(
                WorkRecordError,
            );
        }
        expect(readHeavyCommandLimit(dir)).toEqual({ limit: 2 });
    });

    it('counts a malformed file as Automatic, and a save replaces it', () => {
        const dir = tempDir();

        writeFileSync(join(dir, 'heavy-command-limit.json'), '{');
        expect(readHeavyCommandLimit(dir).limit).toBe('automatic');
        writeHeavyCommandLimit(4, dir);
        expect(readHeavyCommandLimit(dir)).toEqual({ limit: 4 });
    });
});
