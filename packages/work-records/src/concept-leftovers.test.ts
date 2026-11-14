import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'concept-leftovers-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const g = records.create({
        title: 'Choose time display',
        repository: 'fake/api',
        kind: 'concept',
        status: 'Shaping',
    });
    const map = (fog: string) =>
        records.setBody(g.workId, records.read(g.workId).revision, 'map', `## Destination\nShow UTC.\n## Fog\n${fog}`);
    const fogHolds = () => records.reconcile(g.workId).items.filter((i) => i.key.startsWith('fog:'));

    return { records, g, map, fogHolds };
}

test('orphan Fog cannot be acknowledged away and disappears only when the map is repaired', async () => {
    const { records, g, map, fogHolds } = await fixture();

    map('- Fixture files and presentation remain unspecified.');

    const hold = fogHolds()[0]!;

    expect(hold).toMatchObject({ kind: 'map', requiresFix: true });
    expect(hold.summary).toMatch(/Fog.*route/);
    expect(() => records.resolveReconcile(g.workId, hold.key, hold.digest, 'Ignore')).toThrow(/Fix the recorded/);
    map('- none');
    records.setFogGone(g.workId, records.read(g.workId).revision, true);
    expect(fogHolds()).toEqual([]);
    expect(records.refinement(g.workId).complete).toBe(true);
});

test('Fog routes must name live group decisions or an actually saved question, and expire when settled', async () => {
    const { records, g, map, fogHolds } = await fixture();
    const d = records.createPart({
        title: 'Choose timezone',
        repository: 'fake/api',
        kind: 'decision',
        parentId: g.workId,
        parentRevision: records.read(g.workId).revision,
        body: 'Method: grill\nUTC or local?',
        blockerIds: [],
    });

    map(`- [decision: ${d.workId}] UTC or local?`);
    expect(fogHolds()).toEqual([]);
    map(`- [question: ${g.workId}] UTC or local?`);
    expect(fogHolds()).toHaveLength(1);
    records.waitForUser(g.workId, records.read(g.workId).revision, 'UTC or local?');
    expect(fogHolds()).toEqual([]);
    records.resumeFromUser(g.workId, records.read(g.workId).revision, 'Shaping');
    expect(fogHolds()).toHaveLength(1);
    records.setBody(d.workId, records.read(d.workId).revision, 'answer', 'UTC.');
    records.setBody(d.workId, records.read(d.workId).revision, 'domain-drafts', 'none');
    map(`- [decision: ${d.workId}] UTC or local?`);
    expect(records.completion(d.workId).complete).toBe(true);
    expect(fogHolds()).toHaveLength(1);
    map('- [decision: missing] Missing owner');
    expect(fogHolds()).toHaveLength(1);
});

test('a saved Outcome criterion never blocks concept refinement', async () => {
    const { records, g, map } = await fixture();

    map('- none');
    records.setFogGone(g.workId, records.read(g.workId).revision, true);
    records.setReleasePlan(g.workId, records.read(g.workId).revision, {
        steps: [],
        outcomeCheck: 'Choices are recorded.',
    });
    expect(records.refinement(g.workId)).toEqual({ complete: true, reasons: [] });
    expect(records.completion(g.workId).reasons).toContain('No delivery planned.');
});

test('map Fog cannot contradict its recorded gone flag', async () => {
    const { records, g, map } = await fixture();

    map('- none');
    records.setFogGone(g.workId, records.read(g.workId).revision, true);
    map('- Fixture details');
    expect(records.read(g.workId).fogGone).toBe(false);
    expect(() => records.setFogGone(g.workId, records.read(g.workId).revision, true)).toThrow(/Remove resolved Fog/);
    expect(records.refinement(g.workId).complete).toBe(false);
});
