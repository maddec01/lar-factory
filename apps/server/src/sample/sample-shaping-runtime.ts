import type { WorkRecords } from '@lar-factory/work-records';

import hold from '../../test/fixtures/s07-shaping-hold.json' with { type: 'json' };

/** Reproduce the S07 saved hold using disposable fake records and current package digests. */
export function sampleShapingRuntime(records: WorkRecords) {
    let ids: { workId: string; parts: string[] } | undefined;

    return (repository: string) => {
        if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

        if (ids) return ids;

        const parent = records.create({ title: 'Sample preparation hold', repository, kind: 'concept' });
        const parts = ['A1', 'A2', 'B1'].map((title) =>
            records.createPart({
                parentId: parent.workId,
                parentRevision: records.read(parent.workId).revision,
                title: `Seed evidence · ${title}`,
                repository,
                kind: 'build',
                blockerIds: [],
                body: `## What\nPrepare ${title}.\n## Acceptance\nSeed tests pass.\n## Affected areas\n${title} helper.\n## Tests\n\`test/${title}.test.js\`: checks the seed.`,
            }),
        );
        let decision = records.create({ title: 'Preparation decision', repository, kind: 'decision' });

        decision = records.setParent(decision.workId, decision.revision, parent.workId);
        records.snapshotRun(decision.workId, decision.revision, {
            runId: 'sample-preparation',
            kind: 'decision',
            skills: [],
            packaged: {
                version: 'sample',
                reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });
        records.startRoleRun(decision.workId, records.read(decision.workId).revision, {
            runId: 'sample-preparation',
            executionId: 'sample-doubt',
            role: 'doubt',
        });

        let index = 0;
        const summary = hold.doubt.summary.replaceAll(
            /packageDigest `([a-f0-9]+)`/g,
            () => `packageDigest \`${records.doubtPackage(parts[index++]!.workId).packageDigest}\``,
        );

        records.finishRoleRun(decision.workId, records.read(decision.workId).revision, {
            executionId: 'sample-doubt',
            result: 'completed',
            report: null,
            summary,
        });
        for (const record of [parent, ...parts])
            records.waitForUser(record.workId, records.read(record.workId).revision, hold.notice);
        ids = { workId: parent.workId, parts: parts.map((part) => part.workId) };

        return ids;
    };
}
