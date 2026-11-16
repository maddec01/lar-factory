import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { readShapingThreadCleanup, writeShapingThreadCleanup } from './shaping-thread-cleanup.ts';

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
    it('saves a choice in the data folder and reads it back', () => {
        const dir = join(tempDir(), 'Lar Factory');

        expect(writeShapingThreadCleanup('archive', dir)).toBe('archive');
        expect(readShapingThreadCleanup(dir)).toBe('archive');
        expect(readdirSync(dir)).toEqual(['shaping-thread-cleanup.json']);
    });
});
