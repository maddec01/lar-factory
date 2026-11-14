import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { requireCompleteBrief } from './brief-completeness.ts';
import { openWorkRecords } from './work-records.ts';

const feature =
    '## Done when\n- Names survive trimming.\n### Tests\n- `test/name.test.js`: preserves one-character names and rejects empty names.\n## Scope\n### Files\n- `name.js`\n';
const diagnosis =
    '## Cause\nThe length guard requires two characters.\n## Evidence\nparseName("A") returned friend in the reproduction.\n## Regression test\n`test/name.test.js`: keeps one-character names.\n## Red-before-green\nRun the named test against the old guard, observe failure, then fix it and rerun.\n';

test('gate presentation refuses each missing Bug obligation, including empty sections, before any approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-completeness-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        let work = records.create({ title: 'Short names', repository: 'fake/app', kind: 'bug' });

        for (const [heading, label] of [
            ['Cause', 'cause'],
            ['Evidence', 'evidence'],
            ['Regression test', 'named regression test'],
            ['Red-before-green', 'red-before-green'],
        ] as const) {
            const brief = feature + diagnosis.replace(new RegExp(`## ${heading}\\n[^#]*`), `## ${heading}\n`);

            work = records.setBody(work.workId, work.revision, 'brief', brief);
            expect(() => records.displayGate(work.workId)).toThrow(label);
            expect(() => records.gateBatch([work.workId])).toThrow(label);
            expect(records.gate(work.workId).evidence).toEqual([]);
        }
        work = records.setBody(work.workId, work.revision, 'brief', feature + diagnosis);
        expect(records.displayGate(work.workId).brief).toBe(feature + diagnosis);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

for (const kind of ['feature', 'improvement'] as const)
    test(`${kind} gate names all missing acceptance, files and tests`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'brief-completeness-'));
        const records = await openWorkRecords(join(dir, 'work.db'));

        try {
            let work = records.create({ title: 'Names', repository: 'fake/app', kind });

            work = records.setBody(
                work.workId,
                work.revision,
                'brief',
                '## What\nKeep names.\n## Done when\nTODO\n### Tests\nnone\n## Scope\n### Files\nTBD',
            );
            expect(() => records.displayGate(work.workId)).toThrow(/acceptance.*affected files.*named tests/);
            work = records.setBody(work.workId, work.revision, 'brief', feature);
            expect(records.displayGate(work.workId).brief).toBe(feature);
        } finally {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

test('every linked batch member is checked again while unrelated sibling progress preserves Doubt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linked-completeness-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const parent = records.create({ title: 'Linked names', repository: 'fake/app', kind: 'build' });
        const ids = [0, 1].map(
            (index) =>
                records.createPart({
                    parentId: parent.workId,
                    parentRevision: records.read(parent.workId).revision,
                    title: `Names ${index}`,
                    repository: 'fake/app',
                    kind: 'build',
                    body: (feature + diagnosis).replaceAll('name.js', `name-${index}.js`),
                    blockerIds: [],
                }).workId,
        );

        for (const id of ids) {
            const input = records.doubtPackage(id);

            records.recordDoubt(id, input.packageDigest, 'Doubt', 'Reviewed code and named regression.', []);
        }

        const before = records.doubtPackage(ids[0]!).packageDigest;

        records.update(ids[1]!, records.read(ids[1]!).revision, { status: 'Shaping' });
        expect(records.doubtPackage(ids[0]!).packageDigest).toBe(before);
        expect(records.gateBatch(ids).members).toHaveLength(2);

        const missing = feature.replace(/### Tests\n[^#]*/, '### Tests\n');

        records.setBody(ids[1]!, records.read(ids[1]!).revision, 'brief', missing);
        expect(() => records.gateBatch(ids)).toThrow('named tests');
        expect(() => records.displayGate(parent.workId)).toThrow('linked parent has no delivery gate');
        for (const id of ids) expect(records.gate(id).evidence).toEqual([]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

for (const kind of ['feature', 'improvement', 'build', 'issue']) {
    test(`${kind} accepts S01's amended brief and explains the first brief's missing tests`, () => {
        const amended = readFileSync(new URL('../test/briefs/s01-amended.txt', import.meta.url), 'utf8');
        const first = readFileSync(new URL('../test/briefs/s01-first.txt', import.meta.url), 'utf8');

        expect(() => requireCompleteBrief(kind, amended)).not.toThrow();
        expect(() => requireCompleteBrief(kind, first)).toThrow(
            'named tests (Tests or Done when: name a test file plus its case, or a test case with an assertion; e.g. test/cli.test.js: omitted name prints Hello, friend!)',
        );
    });
}

test.each([
    '### Tests\n- test/name.test.js: preserves one-character names.',
    '### Tests\ntest/name.test.js: preserves one-character names.',
    '### Tests\n- In test/name.test.js, verify one-character names survive trimming.',
    '- test/name.test.js: preserves one-character names.',
    '- `test/name.test.js`: preserves one-character names.',
    '- assertions.js: preserves one-character names.',
    '### Acceptance criteria\n- test/name.test.js: preserves one-character names.',
])('accepts named tests in natural brief forms: %s', (tests) => {
    const brief = feature.replace(/### Tests\n[^#]*/, `${tests}\n`);

    expect(() => requireCompleteBrief('build', brief)).not.toThrow();
});

test.each([
    'Run tests and keep them green.',
    '- `name.js`',
    '- test/name.test.js',
    '- TODO',
    '```markdown\n- test/name.test.js: preserves one-character names.\n```',
])('generic prose, filenames alone and fenced examples do not name a test case: %s', (tests) => {
    const brief = feature.replace(/### Tests\n[^#]*/, `### Tests\n${tests}\n`);

    expect(() => requireCompleteBrief('build', brief)).toThrow('named tests');
});

test('Bug accepts an unquoted regression test file and case and explains missing format', () => {
    const unquoted = diagnosis.replaceAll('`', '');

    expect(() => requireCompleteBrief('bug', feature + unquoted)).not.toThrow();
    expect(() => requireCompleteBrief('bug', feature + unquoted.replace(/## Regression test\n[^#]*/, ''))).toThrow(
        'named regression test (Regression test: name a test file plus its case',
    );
});

test('S05-F4-001 refuses C’s constant-only acceptance at single and batch gates', async () => {
    const brief = readFileSync(new URL('../test/briefs/s05-final4-c.txt', import.meta.url), 'utf8');
    const source = 'Consume the v1 greeting envelope in B · S05 round 2 final repeat 4';
    const declaration =
        '\nConsumption test: ' +
        JSON.stringify({
            source,
            test: 'test/sim-891/view.test.mjs: renders supplied accepted text',
            output: 'B returns a string; golden fixture Hello, Pedro!',
            input: 'displayGreeting(element, acceptedText)',
        }) +
        '\n';

    expect(() => requireCompleteBrief('build', brief)).toThrow('Consumption test:');
    expect(() => requireCompleteBrief('build', brief + declaration)).not.toThrow();
    for (const field of ['source', 'test', 'output', 'input']) {
        const row = JSON.parse(declaration.slice(declaration.indexOf('{')));

        row[field] = 'TODO';
        expect(() => requireCompleteBrief('build', brief + '\nConsumption test: ' + JSON.stringify(row))).toThrow(
            'Consumption test:',
        );
    }

    const dir = mkdtempSync(join(tmpdir(), 'consumption-gate-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        let work = records.create({ title: 'C view', repository: 'fake/c', kind: 'build' });

        work = records.setBody(work.workId, work.revision, 'brief', brief);
        expect(() => records.displayGate(work.workId)).toThrow('Consumption test:');
        expect(() => records.gateBatch([work.workId])).toThrow('Consumption test:');
        expect(records.gate(work.workId).evidence).toEqual([]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('consumption Code checklist refuses a constant-only approval and survives reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'consumption-review-'));
    const file = join(dir, 'work.db');
    const records = await openWorkRecords(file);
    const source = 'B accepted text';
    const contract = {
        source,
        test: 'test/view.test.mjs: feeds accepted text to renderer',
        output: 'B string output',
        input: 'displayGreeting(element, message)',
    };

    try {
        let work = records.create({ title: 'C', repository: 'fake/c', kind: 'build' });

        work = records.setBody(
            work.workId,
            work.revision,
            'brief',
            feature + '\nConsumes: `B accepted text`\nConsumption test: ' + JSON.stringify(contract),
        );

        const round = { base: 'abc1234', reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }] } as const;

        expect(() => records.recordReviewRound(work.workId, work.revision, round)).toThrow('consumption:');
        expect(records.reviewRounds(work.workId)).toEqual([]);

        const consumption = [
            {
                source,
                input: contract.input,
                test: contract.test,
                evidence: 'view.mjs:3 takes the supplied string; test/view.test.mjs:8 passes two B-shaped values.',
            },
        ];

        records.recordReviewRound(work.workId, work.revision, {
            ...round,
            reviewers: [{ ...round.reviewers[0], consumption }],
        });

        const reopened = await openWorkRecords(file);

        try {
            expect(reopened.reviewRounds(work.workId)[0]!.reviewers[0]!.consumption).toEqual(consumption);
        } finally {
            reopened.close();
        }
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
