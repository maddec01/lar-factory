import type { HeavyCommandLimit } from '@lar-factory/shared';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    it.each([
        [10, 16, 2],
        [4, 8, 1],
        [2, 4, 1],
        [32, 64, 8],
        [64, 16, 2],
    ])('gives %i CPUs and %i GB %i slots', (cpus, gb, slots) => {
        expect(automaticHeavyCommandLimit(cpus, gb * GB)).toBe(slots);
    });

    it('counts 15.6 GB as 16', () => {
        expect(automaticHeavyCommandLimit(10, 15.6 * GB)).toBe(2);
    });
});

describe('heavy command limit setting', () => {
    it('is Automatic while no file is saved', () => {
        expect(readHeavyCommandLimit(tempDir())).toEqual({ limit: 'automatic' });
    });

    it.each<HeavyCommandLimit>(['automatic', 1, 3])('saves %s in the data folder and reads it back', (limit) => {
        const dir = join(tempDir(), 'Lar Factory');
        expect(writeHeavyCommandLimit(limit, dir)).toBe(limit);
        expect(readHeavyCommandLimit(dir)).toEqual({ limit });
        expect(readdirSync(dir)).toEqual(['heavy-command-limit.json']);
    });

    it('refuses an invalid limit and leaves the saved one as it was', () => {
        const dir = tempDir();
        writeHeavyCommandLimit(2, dir);
        for (const limit of [0, -1, 1.5, '2', 'auto', null, Infinity]) {
            expect(() => writeHeavyCommandLimit(limit as HeavyCommandLimit, dir), String(limit)).toThrow(
                WorkRecordError,
            );
        }
        expect(readHeavyCommandLimit(dir)).toEqual({ limit: 2 });
    });

    it.each([
        ['{', "isn't JSON"],
        ['null', 'needs a limit'],
        ['{ "limit": 0 }', 'needs a limit'],
        ['{ "limit": "4" }', 'needs a limit'],
    ])('counts %s as Automatic and says why, and a save replaces it', (text, why) => {
        const dir = tempDir();
        writeFileSync(join(dir, 'heavy-command-limit.json'), text);
        const read = readHeavyCommandLimit(dir);
        expect(read.limit).toBe('automatic');
        expect(read.problem).toContain(why);
        writeHeavyCommandLimit(4, dir);
        expect(readHeavyCommandLimit(dir)).toEqual({ limit: 4 });
    });

    it("counts a file it can't read as Automatic and says why", () => {
        const dir = tempDir();
        mkdirSync(join(dir, 'heavy-command-limit.json'));
        const read = readHeavyCommandLimit(dir);
        expect(read.limit).toBe('automatic');
        expect(read.problem).toContain("Can't read the heavy command limit setting");
    });
});
