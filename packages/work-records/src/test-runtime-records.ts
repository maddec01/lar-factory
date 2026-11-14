import type { RunSettings, TestRuntime } from '@lar-factory/shared/run-settings';

import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface TestRuntimeRecords {
    testRuntime(id: string, runId?: string): TestRuntime;
}

/** Every role reads its owning run; slices inherit their build. Never consult mutable settings here. */
export function testRuntimeRecords(database: Database, read: (id: string) => WorkRecord): TestRuntimeRecords {
    return {
        testRuntime: (id, runId) =>
            database.read(() => {
                let work = read(id);

                while (work.kind === 'slice' && work.parentId) work = read(work.parentId);

                const row = database.db
                    .prepare(
                        'SELECT content FROM run_settings WHERE work_id=? AND (? IS NULL OR run_id=?) ORDER BY rowid DESC LIMIT 1',
                    )
                    .get(work.workId, runId ?? null, runId ?? null);
                const run = row && (JSON.parse(String(row.content)) as RunSettings);
                const runtime = run?.testRuntime;

                if (!runtime)
                    throw new WorkRecordError(
                        'invalid',
                        run
                            ? `Run ${run.runId} (${run.kind}) held: legacy run settings have no frozen test runtime. Tests were not executed.`
                            : `Run held: no saved run settings${runId ? ` for ${runId}` : ''}. Tests were not executed.`,
                    );

                return runtime;
            }),
    };
}
