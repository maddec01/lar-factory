import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { readAutoBuild, writeAutoBuild } from './auto-build.ts';
import { WorkRecordError } from './database.ts';

const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'auto-build-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MODEL = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };

it('is off on T3 Project default while no file is saved, and keeps a saved switch and model in its own file', () => {
    const dir = tempDir();

    expect(readAutoBuild(dir)).toEqual({ on: false });
    expect(writeAutoBuild({ on: true, model: MODEL }, dir)).toEqual({ on: true, model: MODEL });
    expect(readAutoBuild(dir)).toEqual({ on: true, model: MODEL });
    writeAutoBuild({ on: true }, dir);
    expect(readAutoBuild(dir)).toEqual({ on: true });
    expect(readdirSync(dir)).toEqual(['auto-build.json']);
});

it('refuses an invalid setting and leaves the saved one', () => {
    const dir = tempDir();

    writeAutoBuild({ on: true }, dir);
    expect(() => writeAutoBuild({ on: 'yes' } as never, dir)).toThrow(
        new WorkRecordError(
            'invalid',
            'The Auto-build setting needs "on" as true or false, and a model choice or none.',
        ),
    );
    expect(readAutoBuild(dir)).toEqual({ on: true });
});
