import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { namedWork } from './brief-review.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'brief-review-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    let concept = records.create({ title: 'Invite links', repository: 'fake/plan', kind: 'concept' });

    concept = records.setBody(
        concept.workId,
        concept.revision,
        'map',
        '## Destination\nOpen invite links everywhere.\n\n## Release constraints\nRelease API and client together.',
    );

    const part = (title: string, repository: string, body: string, kind: 'build' | 'decision' = 'build') =>
        records.createPart({
            parentId: concept.workId,
            parentRevision: records.read(concept.workId).revision,
            title,
            repository,
            body,
            kind,
            blockerIds: [],
        });
    const decision = part('Choose endpoint', 'fake/api', 'Method: grill\nWhich endpoint?', 'decision');

    records.setBody(decision.workId, decision.revision, 'answer', 'Use /invite, not /old-invite.');

    const api = part(
        'API',
        'fake/api',
        '## What\nServe /invite.\n## Notes for the builder\nFiles: `src/links.ts`\nContracts: `public-invite`',
    );
    const client = part(
        'Client',
        'fake/client',
        '## What\nFetch /old-invite; assumes CORS.\n## Notes for the builder\nFiles: `src/links.ts`\nContracts: `public-invite`',
    );
    const independent = part('Independent', 'fake/api', 'Files: `src/help.ts`\nContracts: `help`');

    return { records, concept, decision, api, client, independent };
}

it('packages destination, current answers, sibling contracts, release constraints and Dependencies without conversation', async () => {
    const { records, concept, decision, api, client, independent } = await fixture();
    const dependency = records.addDependency(concept.workId, {
        need: 'Configure CORS',
        owner: 'hosting',
        contract: 'Allow client origin',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, client.workId);

    const input = records.doubtPackage(client.workId);

    expect(input.brief).toContain('/old-invite');
    expect(input.destination).toBe('Open invite links everywhere.');
    expect(input.releaseConstraints).toBe('Release API and client together.');
    expect(input.concept?.bodies).toContainEqual(
        expect.objectContaining({ markdown: expect.stringContaining('Release API and client together') }),
    );
    expect(input.decisions).toContainEqual(
        expect.objectContaining({
            workId: decision.workId,
            bodies: expect.arrayContaining([
                expect.objectContaining({ body: 'answer', markdown: 'Use /invite, not /old-invite.' }),
            ]),
        }),
    );
    expect(input.siblings.map((item) => item.workId)).toEqual(expect.arrayContaining([api.workId, independent.workId]));
    expect(input.dependencies[0]?.contract).toBe('Allow client origin');
    expect(input.overlaps).toEqual([
        {
            otherWorkId: api.workId,
            files: [],
            contracts: ['public-invite'],
            ordered: false,
            proposed: { workId: client.workId, blockerId: api.workId },
        },
    ]);
    expect(JSON.stringify(input)).not.toContain('initialContext');
});

it('proposes same-file ordering across concepts and standalone work, and requires edges or recorded reasons', async () => {
    const { records, api } = await fixture();
    const standalone = records.create({ title: 'Other concept or standalone', repository: 'fake/api', kind: 'build' });

    records.setBody(standalone.workId, standalone.revision, 'brief', 'Files: `./src/links.ts`');

    let input = records.doubtPackage(api.workId);

    expect(input.overlaps.find((item) => item.otherWorkId === standalone.workId)).toMatchObject({
        files: ['src/links.ts'],
        proposed: { workId: api.workId, blockerId: standalone.workId },
    });
    expect(() => records.recordDoubt(api.workId, input.packageDigest, 'Doubt', 'Clean', [])).toThrow(
        /ordering blocker/,
    );
    for (const overlap of input.overlaps)
        records.addBlocker(api.workId, records.read(api.workId).revision, overlap.otherWorkId);
    input = records.doubtPackage(api.workId);
    expect(input.overlaps.every((item) => item.ordered)).toBe(true);
    records.recordDoubt(api.workId, input.packageDigest, 'Doubt', 'Code evidence checked; ordering recorded.', []);
    expect(records.currentDoubt(api.workId)?.identity).toBe('Doubt');
});

it('invalidates Doubt and an earlier gate after a sibling contract changes, preserving the approved Spec', async () => {
    const { records, concept, api, client } = await fixture();
    const dependency = records.addDependency(concept.workId, {
        need: 'CORS',
        owner: 'hosting',
        contract: 'Allow client origin',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, api.workId);

    const input = records.doubtPackage(api.workId);

    records.recordDoubt(api.workId, input.packageDigest, 'Doubt', 'Separate compatible contract changes.', [
        { otherWorkId: client.workId, reason: 'Additive compatible consumers; no shared file.' },
    ]);

    let work = records.read(api.workId);

    work = records.attachTicket(api.workId, work.revision, 'fake/api#12');

    // Ticket attachment is not brief content; refresh the review before the gate.
    const reviewed = records.doubtPackage(api.workId);

    records.recordDoubt(api.workId, reviewed.packageDigest, 'Doubt', 'Compatible.', [
        { otherWorkId: client.workId, reason: 'Independent additive behavior.' },
    ]);
    records.recordGate(api.workId, work.revision, {
        briefDigest: records.gate(api.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });

    const approvedSpec = records.specState(api.workId).pending;

    expect(records.gate(api.workId).current).toBe(true);
    records.markDependencyMet(dependency.dependencyId, records.dependency(dependency.dependencyId).revision, 'Pedro');
    expect(records.currentDoubt(api.workId)).not.toBeNull();
    // Ready/status changes are execution metadata and must preserve sibling reviews.
    records.update(client.workId, records.read(client.workId).revision, { status: 'Ready' });
    expect(records.currentDoubt(api.workId)).not.toBeNull();
    records.setPullRequest(client.workId, records.read(client.workId).revision, 'fake/client#21');
    records.observe(client.workId, records.read(client.workId).revision, { of: 'pr', state: 'merged' });
    expect(records.currentDoubt(api.workId)).not.toBeNull();
    expect(records.gate(api.workId).current).toBe(true);
    records.setBody(
        client.workId,
        records.read(client.workId).revision,
        'brief',
        'Remove /invite.\nContracts: `public-invite`',
    );
    expect(records.currentDoubt(api.workId)).toBeNull();
    expect(records.gate(api.workId).current).toBe(false);
    expect(records.publicationReadiness(api.workId).eligible).toBe(false);
    expect(records.publicationSummaries().get(api.workId)?.eligible).toBe(false);
    expect(() => records.recordLaunchIntent(api.workId, records.read(api.workId).revision, 'build')).toThrow(
        /affected-work review/,
    );
    expect(() =>
        records.recordGate(api.workId, records.read(api.workId).revision, {
            briefDigest: records.gate(api.workId).briefDigest!,
            reviewDigest: reviewed.packageDigest,
            approvedBy: 'Pedro',
            evidence: 'Old approval',
        }),
    ).toThrow(/package changed/);
    expect(records.specState(api.workId).pending).toBe(approvedSpec);
    expect(() => records.recordDoubt(api.workId, reviewed.packageDigest, 'Doubt', 'Stale', [])).toThrow(
        /package changed/,
    );
});

it('reads only explicit file and contract declarations for deterministic overlap', () => {
    expect(
        namedWork('Mentions `src/unrelated.ts` in prose.\nFiles: `./src/a.ts`, `src/a.ts`\nContracts: `invite-v1`'),
    ).toEqual({ files: ['src/a.ts'], contracts: ['invite-v1'] });
});

it('recognizes transitive ordering and keeps independent files parallel-capable', async () => {
    const { records, api, client, independent } = await fixture();

    records.addBlocker(api.workId, records.read(api.workId).revision, independent.workId);
    records.addBlocker(independent.workId, records.read(independent.workId).revision, client.workId);

    const input = records.doubtPackage(api.workId);

    expect(input.overlaps).toEqual([
        { otherWorkId: client.workId, files: [], contracts: ['public-invite'], ordered: true, proposed: null },
    ]);
    expect(input.blockers.map((item) => item.workId)).toEqual([independent.workId]);
});

it('shows current answer versions and resolved supersession instead of historical answer bodies', async () => {
    const { records, concept, decision, api } = await fixture();
    const replacement = records.createPart({
        parentId: concept.workId,
        parentRevision: records.read(concept.workId).revision,
        title: 'Replacement',
        repository: 'fake/api',
        kind: 'decision',
        body: 'Method: grill\nChange endpoint?',
        blockerIds: [],
    });

    records.setBody(replacement.workId, replacement.revision, 'answer', 'Use /new-invite.');
    records.supersedeAnswer(decision.workId, records.read(decision.workId).revision, {
        answerRevision: records.decisionAnswer(decision.workId).current!.revision,
        by: {
            kind: 'decision',
            workId: replacement.workId,
            revision: records.read(replacement.workId).revision,
            answerRevision: records.decisionAnswer(replacement.workId).current!.revision,
        },
        affected: [],
    });

    const source = records.doubtPackage(api.workId).decisions.find((item) => item.workId === decision.workId)!;

    expect(source.answer?.current).toBeNull();
    expect(source.answer?.replacement?.text).toBe('Use /new-invite.');
    expect(source.bodies.some((body) => body.body === 'answer')).toBe(false);
});
