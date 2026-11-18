import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { exportMarkdown } from './export.ts';
import { openWorkRecords, type WorkKind, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-records-export-'));

    dirs.push(dir);

    return dir;
};
const open = async () => {
    const records = await openWorkRecords(join(tempDir(), 'work-records.db'));

    opened.push(records);

    return records;
};

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'acme/core', kind });

describe('markdown export', () => {
    it("writes a concept's map and its decisions with safe names for titles holding slashes and dots", async () => {
        const records = await open();
        const [concept, first, second] = [lar(records, 'concept'), lar(records, 'decision'), lar(records, 'decision')];

        records.setBody(concept.workId, 1, 'map', '# Work records / storage\n\nThe map.\n');
        records.setBody(first.workId, 1, 'decision', '# ../../etc/passwd v1.2\n\nUse SQLite.\n');
        records.setBody(second.workId, 1, 'decision', 'No heading here.\n');
        records.setParent(first.workId, 2, concept.workId);
        records.setParent(second.workId, 2, concept.workId);

        const to = tempDir();

        const written = exportMarkdown(records, concept.workId, to);

        expect(written).toEqual([
            join(to, 'map-work-records-storage.md'),
            join(to, 'decision-etc-passwd-v1-2.md'),
            join(to, `decision-${second.workId}.md`),
        ]);
        expect(readdirSync(to).toSorted()).toEqual(written.map((path) => path.slice(to.length + 1)).toSorted());
        expect(readFileSync(join(to, 'decision-etc-passwd-v1-2.md'), 'utf8')).toBe(
            '# ../../etc/passwd v1.2\n\nUse SQLite.\n',
        );
    });

    it('refuses to replace a file the folder already holds and writes nothing', async () => {
        const records = await open();
        const [concept, decision] = [lar(records, 'concept'), lar(records, 'decision')];

        records.setBody(concept.workId, 1, 'map', '# Map');
        records.setBody(decision.workId, 1, 'decision', '# Choice');
        records.setParent(decision.workId, 2, concept.workId);

        const to = tempDir();

        writeFileSync(join(to, 'decision-choice.md'), 'mine');

        expect(() => exportMarkdown(records, concept.workId, to)).toThrow(
            expect.objectContaining({
                code: 'export-failed',
                message: expect.stringContaining(join(to, 'decision-choice.md')),
            }),
        );
        expect(readdirSync(to)).toEqual(['decision-choice.md']);
        expect(readFileSync(join(to, 'decision-choice.md'), 'utf8')).toBe('mine');
    });

    it('keeps a temporary file it did not make', async () => {
        const records = await open();
        const build = lar(records, 'build');

        records.setBody(build.workId, 1, 'brief', '# Brief');

        const to = tempDir();
        const temporary = join(to, `.brief-brief.md.${process.pid}.tmp`);

        writeFileSync(temporary, 'mine');

        expect(() => exportMarkdown(records, build.workId, to)).toThrow(
            expect.objectContaining({ code: 'export-failed' }),
        );
        expect(readdirSync(to)).toEqual([`.brief-brief.md.${process.pid}.tmp`]);
        expect(readFileSync(temporary, 'utf8')).toBe('mine');
    });
});
