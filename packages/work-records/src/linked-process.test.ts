import { readTicketSpec } from '@lar-factory/shared';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { syncPartTickets } from './group-command.ts';
import { syncSpecs } from './spec-sync.ts';
import type { StructureProvider, StructureTicket } from './tracker-sync.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 's05-linked-'));
    const records = await openWorkRecords(workRecordsPath(dir));

    opened.push({ records, dir });

    return { records, dir };
}

test('S05 R2-002: shared Dependency evidence preserves B/C approvals, while a changed prerequisite contract holds B', async () => {
    const { records } = await fixture();
    const g = records.create({ title: 'Linked exchange', repository: 'fake/a', kind: 'build' });
    const b = records.createPart({
        title: 'B reader',
        repository: 'fake/b',
        parentId: g.workId,
        parentRevision: g.revision,
        kind: 'build',
        body: completeBrief('Read v1.\nContracts: `greeting-v1`'),
        blockerIds: [],
    });
    const c = records.createPart({
        title: 'C view',
        repository: 'fake/c',
        parentId: g.workId,
        parentRevision: records.read(g.workId).revision,
        kind: 'build',
        body: completeBrief('Show v1.\nContracts: `greeting-v1`'),
        blockerIds: [b.workId],
    });
    const e = records.addDependency(g.workId, {
        need: 'Hosting',
        owner: 'Hosting team',
        contract: 'Allow reader origin.',
        evidence: 'Initial rollout note.',
    });

    records.addDependencyBlock(e.dependencyId, e.revision, b.workId);
    for (const r of [b, c]) {
        const input = records.doubtPackage(r.workId);

        records.recordDoubt(r.workId, input.packageDigest, 'Doubt', 'Contracts agree.', []);
    }

    const manifest = records.gateBatch([b.workId, c.workId]);

    records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'Board fixture.');

    const briefDigests = [b, c].map((r) => records.gate(r.workId).briefDigest);

    records.updateDependency(e.dependencyId, records.dependency(e.dependencyId).revision, {
        evidence: 'Provider confirmed rollout.',
    });
    expect([b, c].map((r) => records.gate(r.workId).briefDigest)).toEqual(briefDigests);
    expect([b, c].map((r) => records.gate(r.workId).current)).toEqual([true, true]);
    records.updateDependency(e.dependencyId, records.dependency(e.dependencyId).revision, {
        contract: 'Reader must authenticate.',
    });
    expect(records.gate(b.workId).current).toBe(false);
    expect(records.gate(c.workId).current).toBe(true);
});

test.each([undefined, '', 'minimal example'])(
    'S05 R2-007: record-review-round fills selection and handles unchecked note %s',
    async (note) => {
        const { records, dir } = await fixture();
        const work = records.create({ title: 'Greeting consumer', repository: 'fake/a', kind: 'build' });

        records.snapshotRun(work.workId, work.revision, {
            runId: 'review-run',
            kind: 'build',
            projectDefault: { instanceId: 'codex', model: 'test-model' },
            packaged: {
                version: 'fixture',
                reviewers: {
                    code: 'Review code.',
                    security: 'Review security.',
                    ui: 'Review UI.',
                    performance: 'Review performance.',
                },
            },
            skills: [],
        });

        const git = (...args: string[]) =>
            execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

        git('init');
        git('config', 'user.name', 'Fixture');
        git('config', 'user.email', 'fixture@example.invalid');
        git('config', 'core.hooksPath', '/dev/null');
        writeFileSync(join(dir, 'README.md'), 'Before.');
        git('add', 'README.md');
        git('commit', '-m', 'test');

        const base = git('rev-parse', 'HEAD');

        writeFileSync(join(dir, 'README.md'), 'After.');
        git('add', 'README.md');
        git('commit', '-m', 'test');

        const head = git('rev-parse', 'HEAD');
        const cli = (...args: string[]) =>
            spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args, '--data-dir', dir], {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, LAR_FACTORY_DATA_DIR: dir },
                timeout: 15000,
            });
        const selected = cli('select-reviewers', work.workId, '--run-id', 'review-run', '--base', base, '--head', head);

        expect({ status: selected.status, stderr: selected.stderr }).toEqual({ status: 0, stderr: '' });

        const reviewers = JSON.parse(selected.stdout).reviewers.map(
            (r: { id: string; run: boolean; reason: string }) => ({
                axis: r.id,
                verdict: r.run ? 'approve' : 'skipped',
                notChecked: r.run ? (note === 'minimal example' ? undefined : note) : r.reason,
                findings: [],
            }),
        );
        const file = join(dir, 'round.json');

        writeFileSync(
            file,
            JSON.stringify(
                note === 'minimal example'
                    ? { base: head, reviewers: reviewers.filter((r: { axis: string }) => r.axis === 'code') }
                    : { runId: 'review-run', base, reviewers },
            ),
        );

        const recorded = cli(
            'record-review-round',
            work.workId,
            '--revision',
            String(records.read(work.workId).revision),
            '--file',
            file,
        );

        expect({ status: recorded.status, stderr: recorded.stderr }).toEqual({ status: 0, stderr: '' });
        expect(records.reviewRounds(work.workId)[0]?.runId).toBe('review-run');
        expect(records.reviewRounds(work.workId)[0]?.reviewers.every((r) => !!r.selection)).toBe(true);
        expect(records.reviewRounds(work.workId)[0]?.reviewers.find((r) => r.axis === 'code')?.notChecked).toBeNull();
    },
    30000,
);

test('S05: atomic linked growth requests tickets per Settings, recovers an uncertain create and publishes three gated Specs', async () => {
    const { records, dir } = await fixture();
    const repositories = ['fake/a', 'fake/b', 'fake/c'];

    writeFileSync(
        join(dir, 'repository-settings.json'),
        JSON.stringify({
            repositories: repositories.map((repo) => ({
                repo,
                settings: {
                    overrides: { createIssuesFromAddItem: true, writeRefinedSpec: true },
                    access: { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' },
                },
            })),
        }),
    );

    const parent = records.create({ title: 'Linked exchange', repository: 'fake/a', kind: 'build' });
    const result = records.createParts(parent.workId, parent.revision, {
        map: 'Producer, reader, view.',
        parts: repositories.map((repository, n) => ({
            key: `p${n}`,
            title: `Part ${n}`,
            repository,
            kind: 'build',
            body: completeBrief(`Deliver part ${n}.`),
            blockerIds: n ? [`$p${n - 1}`] : [],
        })),
    });

    expect(records.partTicketRequests(parent.workId)).toHaveLength(3);

    const remote = new Map<string, StructureTicket>();
    let creates = 0;
    const provider = {
        create: async (repository: string, title: string, body: string) => {
            creates++;

            const ticket = {
                repository,
                number: 1,
                title,
                body,
                version: '1',
                editorWrite: true,
                titleEditorWrite: true,
            };

            remote.set(repository, ticket);

            if (repository === 'fake/b') throw new Error('Lost provider response');

            return ticket;
        },
        find: async (repository: string, requestId: string) =>
            [...remote.values()].filter((t) => t.repository === repository && t.body.includes(requestId)),
        read: async (repository: string) => remote.get(repository)!,
        readSpec: async (repository: string) => remote.get(repository)!,
        replaceSpec: async (ticket: StructureTicket, body: string) => {
            const updated = { ...ticket, body, version: String(Number(ticket.version) + 1) };

            remote.set(ticket.repository, updated);

            return updated;
        },
    } as unknown as StructureProvider;
    const repos = () => readRepositorySetups(dir).map((setup) => ({ repo: setup.repo, setup, labels: [], role: '' }));
    const deps = {
        repos,
        provider,
        discoverOptions: async () => ({
            provider: 'github' as const,
            labels: [],
            types: [],
            assignees: [],
            milestones: [],
            iterations: [],
            problems: [],
        }),
    };

    expect(await syncPartTickets(parent.workId, records, deps)).toHaveLength(1);
    expect(records.children(parent.workId)).toHaveLength(3);
    expect(await syncPartTickets(parent.workId, records, deps)).toEqual([]);
    expect(creates).toBe(3);
    expect(records.partTicketRequests(parent.workId).every((r) => !!r.ticket)).toBe(true);
    for (const part of result.parts) {
        const input = records.doubtPackage(part.workId);

        records.recordDoubt(part.workId, input.packageDigest, 'Doubt', 'Contracts agree.', []);
        expect(readTicketSpec(remote.get(part.repository)!.body).marked).toBe(false);
    }

    const manifest = records.gateBatch(result.parts.map((r) => r.workId));

    records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'One board batch.');
    await syncSpecs(records, { provider, setups: readRepositorySetups(dir), dir });
    for (const part of result.parts) {
        expect(records.gate(part.workId).current).toBe(true);
        expect(readTicketSpec(remote.get(part.repository)!.body).spec).toBe(records.body(part.workId, 'brief'));
        expect(result.parts.some((r) => remote.get(part.repository)!.body.includes(r.workId))).toBe(false);
    }
    expect(records.gate(parent.workId).evidence).toEqual([]);
});
