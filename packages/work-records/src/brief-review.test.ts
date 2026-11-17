import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

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
    expect(JSON.stringify(input)).not.toContain('initialContext');
});

it('saves Doubt with no ordering reason when two briefs name the same files or contracts', async () => {
    const { records, api, client } = await fixture();
    const standalone = records.create({ title: 'Other concept or standalone', repository: 'fake/api', kind: 'build' });

    records.setBody(standalone.workId, standalone.revision, 'brief', 'Files: `./src/links.ts`');

    const input = records.doubtPackage(api.workId);

    expect(input).not.toHaveProperty('overlaps');
    expect(input).not.toHaveProperty('overlapping');
    expect(input.siblings.map((item) => item.workId)).toContain(client.workId);
    records.recordDoubt(api.workId, input.packageDigest, 'Doubt', 'Code evidence checked.');
    expect(records.currentDoubt(api.workId)?.identity).toBe('Doubt');
});

it('keeps the gate of a brief approved before the upgrade with ordering reasons and a files scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-review-'));
    const path = join(dir, 'records.db');
    const records = await openWorkRecords(path);

    opened.push({ records, dir });

    const links = records.create({ title: 'Links API', repository: 'fake/api', kind: 'build' });
    const linksBrief = 'Serve the links API.\nFiles: `src/links.ts`';

    records.setBody(links.workId, links.revision, 'brief', linksBrief);

    const client = records.create({ title: 'Link client', repository: 'fake/api', kind: 'build' }).workId;
    const scope = {
        files: ['src/links.ts'],
        tests: [],
        behaviour: ['Call the Links API.'],
        excluded: [],
        size: null,
        verify: { required: false, visibleUi: null },
    };
    // The brief as confirmed scope rendered it before shaping stopped recording files.
    const brief =
        '## What\nCall the Links API.\n\n## Done when\n### Behaviour\n- Call the Links API.\n### Tests\n\n\n## Scope\n### Files\n- src/links.ts\n### Size\n\n### Excluded\n\n\n## Verify\nno\n';

    records.confirmScope(client, records.read(client).revision, scope, 'Pedro', 'Yes.');
    records.setBody(client, records.read(client).revision, 'brief', brief);
    records.recordDoubt(client, records.doubtPackage(client).packageDigest, 'Doubt', 'Clean.');
    records.recordGate(client, records.read(client).revision, {
        briefDigest: records.gate(client).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });

    // Frozen version-3 serialization: the stored scope kept its files, and the overlapping Links API was a contract.
    const v3 = createHash('sha256')
        .update(
            JSON.stringify({
                workId: client,
                source: {
                    workId: client,
                    repository: 'fake/api',
                    kind: 'build',
                    request: records.doubtPackage(client).source.request,
                    brief,
                    confirmedScope: scope,
                    dependencies: [],
                },
                decisions: [],
                contracts: [{ workId: links.workId, repository: 'fake/api', kind: 'build', brief: linksBrief }],
                dependencies: [],
                releaseContracts: [],
            }),
        )
        .digest('hex');

    expect(v3).not.toBe(records.doubtPackage(client).packageDigest);

    const db = new DatabaseSync(path);
    const review = JSON.parse(
        String(db.prepare('SELECT content FROM doubt_reviews WHERE work_id=?').get(client)!.content),
    );

    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
        JSON.stringify({
            ...review,
            dependencyVersion: 3,
            packageDigest: v3,
            ordering: [{ otherWorkId: links.workId, reason: 'Same file, independent lines.' }],
        }),
        review.reviewId,
    );
    db.prepare('UPDATE brief_gates SET review_digest=? WHERE work_id=?').run(v3, client);

    // A confirmation saved before shaping stopped recording files.
    const confirmed = JSON.parse(
        String(db.prepare('SELECT content FROM confirmed_scopes WHERE work_id=?').get(client)!.content),
    );

    db.prepare('UPDATE confirmed_scopes SET content=? WHERE work_id=?').run(
        JSON.stringify({ ...confirmed, scope }),
        client,
    );
    db.close();

    const upgraded = await openWorkRecords(path);

    opened.push({ records: upgraded, dir });
    expect(upgraded.currentDoubt(client)).toMatchObject({ dependencyVersion: 4, evidence: 'Clean.' });
    expect(upgraded.gate(client).current).toBe(true);
    expect(upgraded.confirmedScope(client)?.scope).not.toHaveProperty('files');
});

it('marks a stale review from before version 4 checked, keeping it and its gate stale', async () => {
    const { records, client } = await fixture();
    const { dir } = opened.at(-1)!;
    const path = join(dir, 'records.db');

    records.recordDoubt(client.workId, records.doubtPackage(client.workId).packageDigest, 'Doubt', 'Clean.');
    records.recordGate(client.workId, records.read(client.workId).revision, {
        briefDigest: records.gate(client.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });

    const db = new DatabaseSync(path);
    const content = () =>
        JSON.parse(String(db.prepare('SELECT content FROM doubt_reviews WHERE work_id=?').get(client.workId)!.content));
    const review = content();
    const stale = 'f'.repeat(64);

    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(
        JSON.stringify({ ...review, dependencyVersion: 3, packageDigest: stale }),
        review.reviewId,
    );
    db.prepare('UPDATE brief_gates SET review_digest=? WHERE work_id=?').run(stale, client.workId);

    const upgraded = await openWorkRecords(path);

    opened.push({ records: upgraded, dir });
    expect(content()).toEqual({ ...review, dependencyVersion: 4, packageDigest: stale });
    expect(upgraded.currentDoubt(client.workId)).toBeNull();
    expect(upgraded.gate(client.workId).current).toBe(false);
    expect(db.prepare('SELECT review_digest FROM brief_gates WHERE work_id=?').get(client.workId)).toEqual({
        review_digest: stale,
    });

    // Checking it again would refresh these inputs to the current package's.
    const marked = JSON.stringify({
        ...content(),
        packageDigest: records.doubtPackage(client.workId).packageDigest,
        productInputs: null,
    });

    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(marked, review.reviewId);
    opened.push({ records: await openWorkRecords(path), dir });
    expect(JSON.stringify(content())).toBe(marked);
    db.close();
});

it('invalidates Doubt and an earlier gate after a cited sibling contract changes, preserving the approved Spec', async () => {
    const { records, concept, api, client } = await fixture();
    const dependency = records.addDependency(concept.workId, {
        need: 'CORS',
        owner: 'hosting',
        contract: 'Allow client origin',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, api.workId);

    const input = records.doubtPackage(api.workId);

    records.recordDoubt(api.workId, input.packageDigest, 'Doubt', 'Separate compatible contract changes.');

    let work = records.read(api.workId);

    work = records.attachTicket(api.workId, work.revision, 'fake/api#12');

    // Ticket attachment is not brief content; refresh the review before the gate.
    records.setBody(
        api.workId,
        records.read(api.workId).revision,
        'brief',
        `${records.body(api.workId, 'brief')}\nConsumes: \`${client.workId}\``,
    );

    const reviewed = records.doubtPackage(api.workId);

    records.recordDoubt(api.workId, reviewed.packageDigest, 'Doubt', 'Compatible.');
    records.recordGate(api.workId, records.read(api.workId).revision, {
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
    expect(() => records.recordDoubt(api.workId, reviewed.packageDigest, 'Doubt', 'Stale')).toThrow(/package changed/);
});

it('retains unchanged consumer approval only after fresh compatibility review, across reopening', async () => {
    const { records, api, client, concept } = await fixture();
    const id = client.workId;
    const brief = `${records.body(id, 'brief')}\nConsumes: \`${api.workId}\`\nBlocked by: \`${api.workId}\``;

    records.setBody(id, records.read(id).revision, 'brief', brief);

    const reviewed = records.doubtPackage(id);

    records.recordDoubt(id, reviewed.packageDigest, 'Doubt', 'Compatible.');

    const approval = records.recordGate(id, records.read(id).revision, {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Board approval.',
    });

    records.setBody(
        api.workId,
        records.read(api.workId).revision,
        'brief',
        `${records.body(api.workId, 'brief')}\n## Done when\n- Descriptions stay under 60 characters.`,
    );
    expect(records.currentDoubt(id)).toBeNull();
    expect(records.gate(id).current).toBe(false);
    expect(() => records.recordLaunchIntent(id, records.read(id).revision, 'build')).toThrow(/affected-work review/);
    expect(() => records.recordDoubt(id, reviewed.packageDigest, 'Doubt', 'Old package.')).toThrow(/package changed/);
    records.recordDoubt(id, records.doubtPackage(id).packageDigest, 'Fresh Doubt', 'Under-60 contract is compatible.');
    expect(records.gate(id)).toMatchObject({ current: true, passing: approval, evidence: [approval] });
    expect(records.reconcile(concept.workId).items.map((item) => item.key)).not.toContain(`gate:${id}`);

    const { dir } = opened.at(-1)!;
    const reopened = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records: reopened, dir });
    expect(reopened.gate(id)).toMatchObject({ current: true, passing: approval });
    reopened.setBody(id, reopened.read(id).revision, 'brief', brief.replace('Fetch /old-invite', 'Fetch /invite'));
    reopened.recordDoubt(id, reopened.doubtPackage(id).packageDigest, 'Doubt', 'Changed consumer reviewed.');
    expect(reopened.gate(id).current).toBe(false);
    reopened.setBody(id, reopened.read(id).revision, 'brief', brief);
    reopened.recordDoubt(id, reopened.doubtPackage(id).packageDigest, 'Doubt', 'Restored consumer reviewed.');
    expect(reopened.gate(id).current).toBe(true);
    reopened.invalidateGate(id, reopened.read(id).revision);
    reopened.recordDoubt(id, reopened.doubtPackage(id).packageDigest, 'Doubt', 'Reshape reviewed.');
    expect(reopened.gate(id).current).toBe(false);
});

it('requires renewed approval when the consumer Dependency contract changes despite identical brief bytes', async () => {
    const { records, concept, client } = await fixture();
    const dependency = records.addDependency(concept.workId, {
        need: 'CORS',
        owner: 'hosting',
        contract: 'Allow client origin',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, client.workId);
    records.recordDoubt(client.workId, records.doubtPackage(client.workId).packageDigest, 'Doubt', 'Compatible.');
    records.recordGate(client.workId, records.read(client.workId).revision, {
        briefDigest: records.gate(client.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes.',
    });

    const briefDigest = records.gate(client.workId).briefDigest;

    const added = records.addDependency(concept.workId, {
        need: 'New required proof',
        owner: 'hosting',
        contract: 'Serve a new origin',
    });

    records.addDependencyBlock(added.dependencyId, added.revision, client.workId);
    records.recordDoubt(
        client.workId,
        records.doubtPackage(client.workId).packageDigest,
        'Doubt',
        'New contract reviewed.',
    );
    expect(records.gate(client.workId)).toMatchObject({ briefDigest, current: false });
});
