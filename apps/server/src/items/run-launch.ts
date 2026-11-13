import { runSettingsMessage, type FactoryThreadContext, type Item, type ModelChoice } from '@lar-factory/shared';
import { executionTarget, type ExecutionModel } from '@lar-factory/shared/execution-target';
import { BUILTIN_REVIEWERS } from '@lar-factory/shared/factory-settings';
import type { SnapshotRunInput } from '@lar-factory/shared/run-settings';
import type { WorkRecords } from '@lar-factory/work-records';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readExecutionModels } from '../t3/execution-capabilities.ts';
import { launchSelection, projectDefaults } from '../t3/model-choices.ts';

export interface RunLaunchDeps {
    defaults: typeof projectDefaults;
    models: () => Promise<ExecutionModel[]>;
    packaged: (skill: string) => SnapshotRunInput['packaged'];
}

const defaults: RunLaunchDeps = {
    defaults: projectDefaults,
    models: readExecutionModels,
    packaged(skill) {
        const reviewers = Object.fromEntries(
            BUILTIN_REVIEWERS.map((id) => [id, readFileSync(join(skill, 'agents', `reviewer-${id}.md`), 'utf8')]),
        );

        // Content-address the installed instruction bundle, including local drift, rather than claiming a release version.
        return { version: `sha256:${createHash('sha256').update(JSON.stringify(reviewers)).digest('hex')}`, reviewers };
    },
};

/** Retry/handoff reuse the latest logical run of the same kind, even after Settings or package edits. */
export async function prepareRunLaunch(
    records: WorkRecords,
    item: Item,
    build: boolean,
    projectId: string,
    choice: ModelChoice | undefined,
    context: FactoryThreadContext,
    skill: string,
    skills: () => readonly string[],
    deps: RunLaunchDeps = defaults,
) {
    const kind = build ? 'build' : item.kind === 'concept' || item.kind === 'decision' ? item.kind : 'shaping';
    const prior = records.runSettings(item.id).runs.at(-1);
    let snapshot = prior?.kind === kind ? prior : undefined;

    if (!snapshot) {
        const project = context.delegationModel ?? deps.defaults(projectId)?.selection ?? null;

        snapshot = records.snapshotRun(item.id, records.read(item.id).revision, {
            runId: randomUUID(),
            kind,
            projectDefault: project,
            ...(choice && { threadSelection: launchSelection(choice, project) }),
            packaged: deps.packaged(skill),
            skills: [...skills()],
        });
    }

    try {
        const selection = executionTarget(snapshot.thread, await deps.models());

        return { snapshot, selection, message: runSettingsMessage(snapshot) };
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
