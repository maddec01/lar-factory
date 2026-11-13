import { applyAgentWrite, type AgentWriteIntent } from './agent-apply.ts';
import type { WorkRecords } from './work-records.ts';

const active = ['kind', 'setAsideAt', 'finishedAt'];
const structure = [...active, 'parentId', 'blockers', 'dependents', 'buildPhase', 'pullRequest'];
const merge = [
    ...structure,
    'supersededBy',
    'status',
    'repository',
    'children',
    'dependencies',
    'title',
    'ticket',
    'initialContext',
    'body.brief',
    'gate',
];

/** Multi-record intents retain each caller revision, including replacement and Dependency records. */
export function agentConceptWrites(
    records: WorkRecords,
): Pick<WorkRecords, 'setAside' | 'mergeBuild' | 'supersedeAnswer'> {
    return {
        setAside: (id, revision, resolutions = []) => {
            if (!Array.isArray(resolutions) || resolutions.some((item) => !item))
                return records.setAside(id, revision, resolutions);

            const intents: AgentWriteIntent[] = [{ id, revision, fields: [...active, 'parentId', 'dependents'] }];

            for (const item of resolutions) {
                intents.push({ id: item.workId, revision: item.revision, fields: structure });

                if (item.action === 'replace')
                    intents.push({ id: item.blockerId, revision: item.blockerRevision, fields: active });
            }

            return applyAgentWrite(records, intents, (latest) =>
                records.setAside(
                    id,
                    latest(id),
                    resolutions.map((item) => ({
                        ...item,
                        revision: latest(item.workId),
                        ...(item.action === 'replace' ? { blockerRevision: latest(item.blockerId) } : {}),
                    })),
                ),
            );
        },
        mergeBuild: (id, revision, input) => {
            if (!input?.revisions || Array.isArray(input.revisions)) return records.mergeBuild(id, revision, input);

            const intents: AgentWriteIntent[] = [
                { id, revision, fields: merge },
                ...Object.entries(input.revisions).map(([workId, rev]) => ({
                    id: workId,
                    revision: rev,
                    fields: workId === input.into ? merge : structure,
                })),
                ...Object.entries(input.dependencyRevisions ?? {}).map(([dependencyId, rev]) => ({
                    id: dependencyId,
                    revision: rev,
                    fields: ['blocks', 'replacedBy'],
                    entity: 'dependency' as const,
                })),
            ];

            return applyAgentWrite(records, intents, (latest) =>
                records.mergeBuild(id, latest(id), {
                    ...input,
                    revisions: Object.fromEntries(
                        Object.keys(input.revisions).map((workId) => [workId, latest(workId)]),
                    ),
                    dependencyRevisions: Object.fromEntries(
                        Object.keys(input.dependencyRevisions ?? {}).map((dependencyId) => [
                            dependencyId,
                            latest(dependencyId, 'dependency'),
                        ]),
                    ),
                }),
            );
        },
        supersedeAnswer: (id, revision, input) => {
            if (!input?.by || !Array.isArray(input.affected) || input.affected.some((item) => !item))
                return records.supersedeAnswer(id, revision, input);

            const intents: AgentWriteIntent[] = [
                { id, revision, fields: [...active, 'parentId', 'body.answer', 'answerState'] },
                {
                    id: input.by.workId,
                    revision: input.by.revision,
                    fields: [
                        ...active,
                        'parentId',
                        ...(input.by.kind === 'decision' ? ['body.answer', 'answerState'] : ['body.brief', 'gate']),
                    ],
                },
                ...input.affected.map((item) => ({
                    id: item.workId,
                    revision: item.revision,
                    fields: [...active, 'parentId', 'buildPhase', 'pullRequest', 'status', 'body.brief', 'gate'],
                })),
            ];

            return applyAgentWrite(records, intents, (latest) =>
                records.supersedeAnswer(id, latest(id), {
                    ...input,
                    by: { ...input.by, revision: latest(input.by.workId) },
                    affected: input.affected.map((item) => ({ ...item, revision: latest(item.workId) })),
                }),
            );
        },
    };
}
