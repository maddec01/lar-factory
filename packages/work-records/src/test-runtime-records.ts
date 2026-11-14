import type { RunSettings, TestRuntime } from '@lar-factory/shared/run-settings';

import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface TestRuntimeRecords {
    testRuntime(id: string, runId?: string): TestRuntime;
}

/** Slices and roles read the owning build's frozen run, never current project settings. */
export function testRuntimeRecords(database: Database, read: (id: string) => WorkRecord): TestRuntimeRecords {
    return {
        testRuntime: (id, runId) =>
            database.read(() => {
                let work = read(id);

                while (work.kind === 'slice' && work.parentId) work = read(work.parentId);

                const row = database.db
                    .prepare(
                        "SELECT content FROM run_settings WHERE work_id=? AND json_extract(content,'$.kind')='build' AND (? IS NULL OR run_id=?) ORDER BY rowid DESC LIMIT 1",
                    )
                    .get(work.workId, runId ?? null, runId ?? null);
                const runtime = row && (JSON.parse(String(row.content)) as RunSettings).testRuntime;

                if (!runtime)
                    throw new WorkRecordError('invalid', 'Build held: no frozen test runtime in its run settings.');

                return runtime;
            }),
    };
}
