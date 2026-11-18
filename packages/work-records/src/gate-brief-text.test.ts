import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords | undefined;
let dir: string;

afterEach(() => {
    records?.close();
    rmSync(dir, { recursive: true, force: true });
});

it('keeps the approved brief text of approvals made before the migration, so a later change shows its passage', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gate-brief-text-'));

    const path = join(dir, 'work.db');
    const approved = completeBrief('## What\nGreet the visitor.\n');
    const legacy = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });

    legacy.db
        .prepare(
            "INSERT INTO work_records(work_id,title,repository,kind,status,revision,created_at,updated_at) VALUES ('w','Greeting','test/repo','build','Ready',1,'now','now')",
        )
        .run();
    legacy.db
        .prepare(
            "INSERT INTO bodies(work_id,body,markdown,written,has_content,has_passing_gate) VALUES ('w','brief',?,1,1,1)",
        )
        .run(approved);
    legacy.db
        .prepare(
            "INSERT INTO brief_gates(gate_id,work_id,source_revision,brief_digest,approved_by,evidence,recorded_at) VALUES ('g','w',1,?,'user','Approved.','now')",
        )
        .run(createHash('sha256').update(JSON.stringify(approved)).digest('hex'));
    legacy.close();
    records = await openWorkRecords(path);

    const state = records.specState('w');

    records.saveSpecState('w', state.generation, state, {
        text: completeBrief('## What\nGreet the visitor by name.\n'),
        source: 'tracker',
        identity: 'tracker',
        evidence: 'A trusted tracker edit.',
    });

    expect(records.displayGate('w').previousBrief).toBe(approved);
});
