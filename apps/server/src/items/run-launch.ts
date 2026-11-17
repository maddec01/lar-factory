import type { FactoryThreadContext, Item, ModelChoice } from '@lar-factory/shared';
import { executionTarget, type ExecutionModel } from '@lar-factory/shared/execution-target';
import { BUILTIN_REVIEWERS } from '@lar-factory/shared/factory-settings';
import type { BuildMethod, SnapshotRunInput } from '@lar-factory/shared/run-settings';
import type { WorkRecords } from '@lar-factory/work-records';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runningRelease } from '../skills/release-folders.ts';
import { readExecutionModels } from '../t3/execution-capabilities.ts';
import { launchSelection, projectDefaults } from '../t3/model-choices.ts';

export interface RunLaunchDeps {
    defaults: typeof projectDefaults;
    models: () => Promise<ExecutionModel[]>;
    packaged: (skill: string) => SnapshotRunInput['packaged'];
    /** The running app release a new run freezes, or undefined without a packaged app. */
    release: () => string | undefined;
}

const defaults: RunLaunchDeps = {
    defaults: projectDefaults,
    models: readExecutionModels,
    packaged(skill) {
        const reviewers = Object.fromEntries(
            BUILTIN_REVIEWERS.map((id) => [id, readFileSync(join(skill, 'agents', `reviewer-${id}.md`), 'utf8')]),
        );

        // Content-address the reviewer texts the run reads, rather than claiming a release version.
        return { version: `sha256:${createHash('sha256').update(JSON.stringify(reviewers)).digest('hex')}`, reviewers };
    },
    release: () => runningRelease(),
};

/** Retry/handoff reuse the latest logical run of the same kind, even after Settings or package edits. */
export async function prepareRunLaunch(
    records: WorkRecords,
    item: Item,
    build: boolean,
    projectId: string,
    choice: ModelChoice | undefined,
    context: Pick<FactoryThreadContext, 'delegationModel'>,
    /** The lar-build folder of a release, whose reviewer texts a new run freezes. */
    larBuild: (release: string | undefined) => string,
    /** The project's settings a new run freezes, read only when it starts one. */
    projectSettings: () => { skills: readonly string[]; buildMethod?: BuildMethod },
    deps: RunLaunchDeps = defaults,
) {
    const kind = build ? 'build' : item.kind === 'concept' || item.kind === 'decision' ? item.kind : 'shaping';
    const prior = records.runSettings(item.id).runs.at(-1);
    let snapshot = prior?.kind === kind ? prior : undefined;

    if (!snapshot) {
        const project = context.delegationModel ?? deps.defaults(projectId)?.selection ?? null;
        const release = deps.release();
        const { skills, buildMethod } = projectSettings();

        snapshot = records.snapshotRun(item.id, records.read(item.id).revision, {
            runId: randomUUID(),
            kind,
            projectDefault: project,
            ...(choice && { threadSelection: launchSelection(choice, project) }),
            packaged: deps.packaged(larBuild(release)),
            skills: [...skills],
            ...(release && { release }),
            ...(buildMethod && { buildMethod }),
        });
    }

    try {
        const selection = executionTarget(snapshot.thread, await deps.models());

        // A run saved before launches were recorded keeps its earlier thread message on every retry.
        return { snapshot, selection, earlier: !records.runLaunches(item.id, snapshot.runId).newRun };
    } catch (error) {
        const failure = (error as Error).message;
        const executionId = randomUUID();

        records.startRoleRun(item.id, records.read(item.id).revision, {
            runId: snapshot.runId,
            executionId,
            role: 'thread',
        });
        records.finishRoleRun(item.id, records.read(item.id).revision, {
            executionId,
            result: 'failed',
            failure,
            report: null,
        });
        throw error;
    }
}
