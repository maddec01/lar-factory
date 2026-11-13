import { executionTarget } from '@lar-factory/shared/execution-target';
import type { RoleRunInput, RunSettings } from '@lar-factory/shared/run-settings';
import { randomUUID } from 'node:crypto';
import { accessSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';

import { agentWrites } from './agent-writes.ts';
import { refreshBoards } from './board-refresh.ts';
import { roleCapabilities, roleFinish } from './role-evidence.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const shellPath = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const json = (path: string) => JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) as unknown;

/** Use only the parent's supplied installation; a missing entry never falls back to global skills. */
function preamble(snapshot: RunSettings, role: string, dataDir: string): string {
    const bin = process.env.LAR_FACTORY_BIN;
    const shape = process.env.LAR_FACTORY_SHAPE_SKILL;
    const build = process.env.LAR_FACTORY_BUILD_SKILL;

    for (const [name, path] of Object.entries({
        LAR_FACTORY_BIN: bin,
        LAR_FACTORY_SHAPE_SKILL: shape,
        LAR_FACTORY_BUILD_SKILL: build,
    })) {
        if (!path || !isAbsolute(path)) throw new Error(`${name} must carry the parent's absolute path.`);

        accessSync(path);
    }

    const cli = join(bin!, 'lar-work');

    accessSync(cli);

    return [
        `Factory role ${role}; work ID ${snapshot.workId}; run ID ${snapshot.runId}.`,
        `Read ${snapshot.kind === 'build' ? build : shape} first; resolve relative files there. Never discover skills independently or read global skills first. Hold if a supplied path is unavailable.`,
        `Factory skill entries: ${JSON.stringify({ 'lar-shape': shape, 'lar-build': build })}`,
        'Before factory commands, set this environment in that command shell:',
        `export LAR_FACTORY_DATA_DIR=${shellPath(dataDir)}`,
        `export PATH=${shellPath(bin!)}:"$PATH"`,
        `export LAR_FACTORY_BIN=${shellPath(bin!)}`,
        `export LAR_FACTORY_SHAPE_SKILL=${shellPath(shape!)}`,
        `export LAR_FACTORY_BUILD_SKILL=${shellPath(build!)}`,
        ...(process.env.LAR_FACTORY_AZURE_READ_ONLY === '1'
            ? [
                  "export LAR_FACTORY_AZURE_READ_ONLY='1'",
                  'All Azure DevOps organizations are read-only. Never launch Azure implementation or write through another tool.',
              ]
            : []),
        `Use ${shellPath(cli)} for work records. Carry these exact skill entries and CLI/data environment in every handoff.`,
        `Frozen role settings: ${JSON.stringify(snapshot.roles)}`,
        `Frozen project skills: ${JSON.stringify(snapshot.skills)}`,
        `For every child role, use lar-work role-launch ${snapshot.workId} --run-id ${snapshot.runId} --role ROLE --capabilities F --task F and pass its JSON to delegate_task unchanged. Call orchestrator_capabilities first (search omitted models) and save its JSON as the capabilities file. On completion, pass T3's task result JSON to lar-work role-finish ${snapshot.workId} --execution-id ID. Stop if either command exits non-zero; cancel a mismatched active child.`,
        `Select reviewers with --run-id ${snapshot.runId}; carry runId and selection evidence into review records.`,
        'Apply the supplied skill shared/orchestration.md, including its wait rules. Final report: at most 300 words; no whole files, logs or screenshots.',
        ...snapshot.reviewers
            .filter((reviewer) => role === `reviewer:${reviewer.id}`)
            .map((reviewer) => reviewer.instructions.text),
    ].join('\n');
}

/** Mechanical local orchestration. No tracker synchronization, T3 calls or shell execution. */
export async function roleCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: Object.fromEntries(
                ['data-dir', 'run-id', 'role', 'capabilities', 'task', 'execution-id', 'file', 'isolation'].map(
                    (key) => [key, { type: 'string' as const }],
                ),
            ),
        });
        const workId = positionals[0];

        if (positionals.length !== 1 || !workId) throw new Error(`${command} needs a work ID.`);

        if (command === 'role-launch' && (!values['run-id'] || !values.role || !values.capabilities || !values.task))
            throw new Error('role-launch needs --run-id, --role, --capabilities and --task.');

        if (command === 'role-finish' && !values['execution-id']) throw new Error('role-finish needs --execution-id.');

        if (values.isolation && !['shared', 'worktree'].includes(values.isolation))
            throw new Error('Invalid isolation.');

        const databasePath = workRecordsPath(values['data-dir']);

        records = agentWrites(await openWorkRecords(databasePath));

        const revision = () => records!.read(workId).revision;
        const hold = (failure: string) => {
            records!.setNeedsYou(workId, revision(), failure);
            throw new Error(failure);
        };

        if (command === 'role-finish') {
            const attempt = records
                .runSettings(workId)
                .roleRuns.find((run) => run.executionId === values['execution-id']);

            if (!attempt) throw new Error('No such role execution belongs to this work record.');

            let input: unknown;

            try {
                input = json(values.file ?? '-');
            } catch {
                input = null;
            }

            const finish = roleFinish(attempt, input);
            let result;

            try {
                result = records.finishRoleRun(workId, revision(), finish);
            } catch (error) {
                return hold(finish.failure ?? (error as Error).message);
            }

            if (finish.failure) return hold(finish.failure);

            await refreshBoards(workId, values['data-dir']);
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

            return 0;
        }

        const snapshot = records.runSettings(workId, values['run-id']).runs[0]!;
        const role = values.role!;
        const identity = {
            runId: snapshot.runId,
            executionId: values['execution-id'] ?? randomUUID(),
            role: role as RoleRunInput['role'],
        };
        let attempt;

        try {
            const request =
                role === 'thread' ? snapshot.thread : snapshot.roles[identity.role as keyof typeof snapshot.roles];

            if (!request) throw new Error(`Unknown run role: ${role}.`);

            const selection = executionTarget(request, roleCapabilities(json(values.capabilities!)));
            const task = `${preamble(snapshot, role, dirname(databasePath))}\n\n${readFileSync(values.task!, 'utf8')}`;

            attempt = records.startRoleRun(workId, revision(), { ...identity, launchOptions: selection.options });

            if (attempt.endedAt !== null) throw new Error('This attempt already finished; use a new execution ID.');

            await refreshBoards(workId, values['data-dir']);
            process.stdout.write(
                `${JSON.stringify(
                    {
                        clientRequestId: attempt.executionId,
                        target: {
                            providerInstanceId: selection.instanceId,
                            model: selection.model,
                            options: Object.fromEntries(selection.options!.map(({ id, value }) => [id, value])),
                        },
                        isolation:
                            values.isolation ?? (['implementer', 'prototype'].includes(role) ? 'worktree' : 'shared'),
                        task,
                    },
                    null,
                    2,
                )}\n`,
            );
        } catch (error) {
            const failure = (error as Error).message;

            attempt ??= records.runSettings(workId).roleRuns.find((run) => run.executionId === identity.executionId);

            if (attempt && (attempt.runId !== identity.runId || attempt.role !== identity.role)) throw error;

            attempt ??= records.startRoleRun(workId, revision(), identity);

            if (attempt.endedAt !== null) throw error;

            records.finishRoleRun(workId, revision(), {
                executionId: attempt.executionId,
                report: null,
                result: 'failed',
                failure,
            });

            return hold(failure);
        }

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
