import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { readRetention, writeRetention } from './retention.ts';

it('refuses a malformed setting and leaves the saved one as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-'));

    try {
        writeRetention({ hideAfterDays: 3, deleteAfterDays: null }, dir);
        expect(() => writeRetention({ hideAfterDays: -1, deleteAfterDays: null }, dir)).toThrow(
            'whole numbers of days',
        );
        expect(() => writeRetention({ hideAfterDays: 7, deleteAfterDays: 1.5 }, dir)).toThrow('whole numbers of days');
        expect(readRetention(dir)).toEqual({ hideAfterDays: 3, deleteAfterDays: null });
        writeFileSync(join(dir, 'retention.json'), '{');
        expect(() => readRetention(dir)).toThrow("isn't JSON");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
