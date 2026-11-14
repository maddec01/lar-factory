import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import retro from '../test/s07-retro.json' with { type: 'json' };
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'status-approval-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const group = records.create({ title: 'G', repository: 'fake/a', kind: 'concept' }).workId;
    const revision = (id: string) => records.read(id).revision;
    const part = (title: string, kind: 'build' | 'decision', body: string) =>
        records.createPart({
            parentId: group,
            parentRevision: revision(group),
            title,
            repository: 'fake/a',
            kind,
            body,
            blockerIds: [],
        }).workId;
    const decision = part('DEC', 'decision', 'Method: grill\nChoose label and trimming.');
    const build = part(
        'A2',
        'build',
        completeBrief(
            `## What\nTrim before lowercase, per ${decision}.\n\n## Done when\nReturn amber.\n\n## Scope\nFiles: \`label.js\``,
        ),
    );
    const write = (id: string, body: 'answer' | 'map' | 'domain-drafts' | 'brief', text: string) =>
        records.setBody(id, revision(id), body, text);

    write(decision, 'answer', retro['DEC answer'].before);
    write(decision, 'domain-drafts', 'none');
    write(group, 'map', retro['G map'].before);
    records.setFogGone(group, revision(group), true);

    const reviewed = records.doubtPackage(build);

    records.recordDoubt(build, reviewed.packageDigest, 'Doubt', 'Product contracts checked.', []);
    records.recordGate(build, revision(build), {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Approved.',
    });
    records.update(build, revision(build), { status: 'Ready' });
    records.setConceptBuildRun(group, revision(group), 'running');

    return { records, path: join(dir, 'records.db'), group, decision, build, revision, write, reviewed };
}

it.each(['command', 'legacy database'])(
    'S07 A1 retro (%s): identical brief retains approval and G keeps running after the exact live prose diff',
    async (mode) => {
        const { records, path, group, decision, build, revision, reviewed } = await fixture();
        const brief = records.body(build, 'brief');
        const approvalDigest = records.displayGate(build).approvalDigest;
        const history = records.answerHistory(decision);

        records.refreshProjections(
            group,
            Object.fromEntries([group, decision, build].map((id) => [id, revision(id)])),
            {
                answers: { [decision]: retro['DEC answer'].after },
                map: retro['G map'].after,
            },
        );

        if (mode === 'legacy database') {
            const db = new DatabaseSync(path);
            const row = db
                .prepare('SELECT content FROM decision_answers WHERE work_id=? ORDER BY answer_revision DESC LIMIT 1')
                .get(decision)!;
            const answer = JSON.parse(String(row.content));

            answer.text = retro['DEC answer'].after;
            db.prepare('UPDATE decision_answers SET content=? WHERE work_id=? AND answer_revision=?').run(
                JSON.stringify(answer),
                decision,
                answer.revision,
            );
            db.prepare("UPDATE bodies SET markdown=? WHERE work_id=? AND body='answer'").run(answer.text, decision);
            db.close();
        }

        expect(records.body(build, 'brief')).toBe(brief);
        expect(records.displayGate(build).approvalDigest).toBe(approvalDigest);
        expect(records.doubtPackage(build).packageDigest).toBe(reviewed.packageDigest);
        expect(records.gate(build).current).toBe(true);
        records.reconcileConceptBuildRuns();
        expect(records.conceptBuildPlan(group).run?.state).toBe('running');
        // Status-only answer refreshes must not create another product answer version.
        expect(records.answerHistory(decision).map(({ revision }) => revision)).toEqual(
            history.map(({ revision }) => revision),
        );

        if (mode === 'command') expect(records.body(decision, 'answer')).not.toContain('A1 is merged and Done');
    },
);

it('excludes explicit status/history sections but invalidates a changed chosen product answer', async () => {
    const { records, group, decision, build, write } = await fixture();

    write(
        decision,
        'answer',
        '## Product\nUse AMBER; trim before lowercase.\n\n## Status\nA1 Ready.\n\n## History\nOld sample BLUE.',
    );
    write(group, 'map', retro['G map'].before);

    const input = records.doubtPackage(build);

    records.recordDoubt(build, input.packageDigest, 'Doubt', 'Checked.', []);
    records.recordGate(build, records.read(build).revision, {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes.',
    });
    write(
        decision,
        'answer',
        '## Product\nUse AMBER; trim before lowercase.\n\n## History\nA1 merged; prior sample GREEN.',
    );
    expect(records.gate(build).current).toBe(true);
    write(decision, 'answer', '## Product\nUse BLUE; preserve whitespace.\n\n## History\nA1 merged.');
    expect(records.gate(build).current).toBe(false);
});

it('keeps product contracts inside code fences and beside workflow-looking prose binding', async () => {
    const { records, group, decision, build, write } = await fixture();

    write(
        decision,
        'answer',
        '## Product\nA2 waits for A1.\n```text\n## History\nA1 is Ready.\n```\n## History\nA1 merged.',
    );
    write(group, 'map', retro['G map'].before);
    records.recordDoubt(build, records.doubtPackage(build).packageDigest, 'Doubt', 'Checked.', []);
    records.recordGate(build, records.read(build).revision, {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes.',
    });
    write(
        decision,
        'answer',
        '## Product\nA2 waits for A1.\n```text\n## History\nA1 is Done.\n```\n## History\nA1 merged.',
    );
    expect(records.gate(build).current).toBe(false);
});

it('upgrades a still-current v2 cited-answer approval without reviving a stale product approval', async () => {
    const { path, decision, build, reviewed } = await fixture();
    const source = reviewed.source;
    // Frozen v2 serialization, before delivery prose was excluded from cited answers.
    const legacy = createHash('sha256')
        .update(
            JSON.stringify({
                workId: build,
                source: {
                    workId: build,
                    repository: source.repository,
                    kind: source.kind,
                    request: source.request,
                    brief: reviewed.brief,
                    confirmedScope: source.confirmedScope,
                    dependencies: [],
                },
                decisions: [{ workId: decision, answer: retro['DEC answer'].before }],
                contracts: [],
                dependencies: [],
                releaseContracts: [],
            }),
        )
        .digest('hex');

    expect(legacy).not.toBe(reviewed.packageDigest);

    const db = new DatabaseSync(path);
    const row = db.prepare('SELECT content FROM doubt_reviews WHERE work_id=? ORDER BY rowid DESC LIMIT 1').get(build)!;
    const review = JSON.parse(String(row.content));

    delete review.productInputs;
    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
        JSON.stringify({ ...review, dependencyVersion: 2, packageDigest: legacy }),
        review.reviewId,
    );
    db.prepare('UPDATE brief_gates SET review_digest=? WHERE work_id=?').run(legacy, build);
    db.close();

    const upgraded = await openWorkRecords(path);

    opened.push({ records: upgraded, dir: join(path, '..') });
    expect(upgraded.gate(build).current).toBe(true);
    upgraded.setBody(decision, upgraded.read(decision).revision, 'answer', '## Product\nUse BLUE instead.');
    expect(upgraded.gate(build).current).toBe(false);

    const reopened = await openWorkRecords(path);

    opened.push({ records: reopened, dir: join(path, '..') });
    expect(reopened.gate(build).current).toBe(false);
});

it.each(['concept', 'build'] as const)('group parent %s cannot be set Ready like a delivery build', async (kind) => {
    const { records, group, revision } = await fixture();
    const parent =
        kind === 'concept'
            ? group
            : records.create({ title: 'Linked parent', repository: 'fake/a', kind, status: 'Shaping' }).workId;

    if (kind === 'build')
        records.createPart({
            parentId: parent,
            parentRevision: revision(parent),
            title: 'Child',
            repository: 'fake/a',
            kind: 'build',
            body: 'Child',
            blockerIds: [],
        });

    const before = records.read(parent);

    expect(() => records.update(parent, before.revision, { status: 'Ready' })).toThrow(/group.*parts/i);
    expect(records.read(parent)).toEqual(before);
});
