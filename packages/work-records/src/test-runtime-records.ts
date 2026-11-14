import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface TestRuntime {
    node: string;
    version: string;
}
export interface TestRuntimeRecords {
    requireTestRuntime(id: string, runtime: TestRuntime): void;
}

/** A build and its slices share the first validated runtime; changing settings cannot mix test environments. */
export function testRuntimeRecords(database: Database, read: (id: string) => WorkRecord): TestRuntimeRecords {
    const { db } = database;

    return {
        requireTestRuntime: (id, runtime) =>
            database.write(() => {
                let work = read(id);

                while (work.kind === 'slice' && work.parentId) work = read(work.parentId);

                const old = db.prepare('SELECT content FROM test_runtimes WHERE work_id=?').get(work.workId);

                if (old) {
                    const pinned = JSON.parse(String(old.content)) as TestRuntime;

                    if (pinned.node !== runtime.node || pinned.version !== runtime.version)
                        throw new WorkRecordError(
                            'invalid',
                            `This build already uses ${pinned.node} ${pinned.version}. Restore that project test runtime before running more tests.`,
                        );
                } else
                    db.prepare('INSERT INTO test_runtimes(work_id,content) VALUES(?,?)').run(
                        work.workId,
                        JSON.stringify(runtime),
                    );
            }),
    };
}
