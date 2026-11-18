import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vite-plus/test';

import { scopeMarkdown, type BriefScope } from './brief-scope.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const stores: WorkRecords[] = [];
const scope: BriefScope = {
    tests: ['`test/cli.test.js`: Named/default/trimmed input and ignored extras.'],
    behaviour: ['Use greet(argv[2]); preserve the existing API.'],
    excluded: ['No README examples or dependencies.'],
    size: 'Small',
    verify: { required: false, visibleUi: null },
};
const fixture = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-brief-scope-'));

    dirs.push(dir);

    const records = await openWorkRecords(join(dir, 'work-records.db'));

    stores.push(records);

    const work = records.create({
        title: 'CLI greeting',
        context: 'Only cli.js and test/cli.test.js. Small.',
        repository: 'example/product',
        kind: 'feature',
    });
    const file = join(dir, 'scope.json');

    writeFileSync(file, JSON.stringify(scope));

    const cli = async (...args: string[]) => {
        try {
            const { stdout, stderr } = await promisify(execFile)(
                process.execPath,
                [
                    '--disable-warning=ExperimentalWarning',
                    join(import.meta.dirname, 'cli.ts'),
                    ...args,
                    '--data-dir',
                    dir,
                ],
                { cwd: dir, timeout: 10000 },
            );

            return { code: 0, stdout, stderr };
        } catch (error) {
            return error as { code: number; stdout: string; stderr: string };
        }
    };
    const confirm = (revision = records.read(work.workId).revision) =>
        cli(
            'confirm-scope',
            work.workId,
            '--revision',
            String(revision),
            '--file',
            file,
            '--identity',
            'User',
            '--evidence',
            'Yes, that exact scope.',
        );

    return { dir, records, id: work.workId, file, cli, confirm };
};

afterEach(() => {
    for (const records of stores.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('captures understanding once, persists across CLI runs and renders without re-deriving', async () => {
    const f = await fixture();
    const captured = await f.confirm();

    expect(captured.code).toBe(0);
    expect(JSON.parse(captured.stdout)).toMatchObject({
        scope,
        sourceRevision: 1,
        title: 'CLI greeting',
        context: 'Only cli.js and test/cli.test.js. Small.',
        confirmedBy: 'User',
        response: 'Yes, that exact scope.',
    });
    expect(f.records.read(f.id).revision).toBe(2);
    expect((await f.confirm()).stdout).toBe(captured.stdout);
    expect(f.records.read(f.id).revision).toBe(2);
    expect((await f.cli('confirmed-scope', f.id)).stdout).toBe(captured.stdout);
    expect((await f.cli('confirmed-scope', f.id, '--markdown')).stdout).toBe(scopeMarkdown(scope));
}, 15000);

it('saves a scope without files when confirm-scope gets an old files key', async () => {
    const f = await fixture();

    writeFileSync(f.file, JSON.stringify({ files: ['cli.js'], ...scope }));
    expect((await f.confirm()).code).toBe(0);
    expect(f.records.confirmedScope(f.id)?.scope).toEqual(scope);
    expect(f.records.confirmedScope(f.id)?.scope).not.toHaveProperty('files');
}, 15000);

it('takes settled scope from the submitted request through completeness, scope checking and the final gate', async () => {
    const f = await fixture();
    const submitted = { ...scope, repositories: ['example/product'], openDecisions: [] };
    const capture = () =>
        f.cli(
            'confirm-scope',
            f.id,
            '--revision',
            String(f.records.read(f.id).revision),
            '--file',
            f.file,
            '--source',
            'submitted-request',
        );

    writeFileSync(f.file, JSON.stringify(submitted));

    const captured = await capture();

    expect(captured.code).toBe(0);
    expect(JSON.parse(captured.stdout)).toMatchObject({
        source: 'submitted-request',
        title: 'CLI greeting',
        context: 'Only cli.js and test/cli.test.js. Small.',
        confirmedBy: null,
        response: null,
    });
    expect((await f.cli('confirmed-scope', f.id)).stdout).toBe(captured.stdout);
    expect((await capture()).stdout).toBe(captured.stdout);
    expect(JSON.parse((await f.cli('choose-structure', f.id)).stdout).structure).toBe('single');

    f.records.setBody(f.id, f.records.read(f.id).revision, 'brief', scopeMarkdown({ ...submitted, tests: [] }));
    expect((await f.cli('brief-scope-check', f.id)).code).toBe(1);
    expect((await f.cli('gate', f.id)).code).toBe(1);

    f.records.setBody(f.id, f.records.read(f.id).revision, 'brief', scopeMarkdown(submitted));
    expect((await f.cli('brief-scope-check', f.id)).code).toBe(0);
    expect((await f.cli('gate', f.id)).code).toBe(0);
    expect(f.records.gate(f.id).current).toBe(false);

    const review = f.records.doubtPackage(f.id);

    f.records.recordDoubt(f.id, review.packageDigest, 'Doubt', 'Submitted constraints match the code and brief.');

    const display = JSON.parse((await f.cli('gate', f.id)).stdout).display;

    expect(display.brief).not.toContain('## Confirmed');
    f.records.recordDisplayedGate(display, display.approvalDigest, 'User', 'Approved brief in board.');
    expect(f.records.gate(f.id).current).toBe(true);

    writeFileSync(f.file, JSON.stringify({ ...submitted, behaviour: ['Expand the greeting API.'] }));
    expect((await capture()).code).toBe(1);
    expect(f.records.gate(f.id).current).toBe(true);
    expect(f.records.confirmedScope(f.id)?.scope).toEqual(submitted);

    expect((await f.confirm()).code).toBe(0);
    expect(f.records.confirmedScope(f.id)).toMatchObject({
        source: 'user-response',
        response: 'Yes, that exact scope.',
    });
    expect(f.records.gate(f.id).current).toBe(false);
}, 15000);

it('requires real answers for unresolved scope and refuses invented replies on submitted requests', async () => {
    const f = await fixture();
    const settled = { ...scope, repositories: ['example/product'], openDecisions: [] };

    for (const unresolved of [
        scope,
        { ...settled, openDecisions: ['Choose casing rules.'] },
        { ...settled, repositories: ['example/product', 'example/client'], openDecisions: ['Show ungrouped badges?'] },
        { ...settled, repositories: ['example/client'] },
    ]) {
        expect(() => f.records.confirmScope(f.id, 1, unresolved, undefined, undefined, 'submitted-request')).toThrow(
            'record a user-response',
        );
    }
    expect(() => f.records.confirmScope(f.id, 1, settled, 'User', 'Confirmed', 'submitted-request')).toThrow(
        'no confirmation identity or reply',
    );
    expect(() => f.records.confirmScope(f.id, 1, settled)).toThrow('explicit understanding response');
    expect(f.records.read(f.id).revision).toBe(1);
    expect(f.records.confirmedScope(f.id)).toBeNull();

    const concept = f.records.create({ title: 'Explore greetings', repository: 'example/product', kind: 'concept' });

    expect(() => f.records.confirmScope(concept.workId, 1, settled, undefined, undefined, 'submitted-request')).toThrow(
        'record a user-response',
    );
});

it('fails closed without confirmation and reports missing/extra scope with a failing exit code', async () => {
    const f = await fixture();

    expect((await f.cli('brief-scope-check', f.id)).stderr).toContain('No confirmed scope');
    await f.confirm();
    f.records.setBody(f.id, 2, 'brief', '## Done when\n- Add README examples\n## Verify\nyes: CLI output is visible');

    const failed = await f.cli('brief-scope-check', f.id);

    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
        ok: false,
        missing: expect.any(Array),
        extra: expect.any(Array),
    });

    const refusedDisplay = await f.cli('gate', f.id);

    expect(refusedDisplay.code).toBe(1);
    expect(refusedDisplay.stdout).toBe('');
    expect(refusedDisplay.stderr).toContain('brief differs from confirmed scope');

    const gate = f.records.gate(f.id);

    expect(() =>
        f.records.recordGate(f.id, 3, { briefDigest: gate.briefDigest!, approvedBy: 'User', evidence: 'yes' }),
    ).toThrow('brief differs from confirmed scope');
    expect(f.records.gate(f.id).evidence).toEqual([]);
    f.records.setBody(f.id, 3, 'brief', scopeMarkdown(scope));

    const passed = await f.cli('brief-scope-check', f.id);

    expect(passed.code).toBe(0);
    expect(JSON.parse(passed.stdout)).toEqual({
        ok: true,
        briefDigest: f.records.gate(f.id).briefDigest,
        missing: [],
        extra: [],
    });

    const review = f.records.doubtPackage(f.id);

    expect(review.source.confirmedScope).toEqual(scope);
    f.records.recordDoubt(f.id, review.packageDigest, 'Doubt', 'Confirmed scope and code checked.');

    const displayed = JSON.parse((await f.cli('gate', f.id)).stdout).display;
    const displayFile = join(f.dir, 'display.json');

    writeFileSync(displayFile, JSON.stringify(displayed));
    expect(
        (
            await f.cli(
                'record-gate',
                f.id,
                '--file',
                displayFile,
                '--digest',
                displayed.approvalDigest,
                '--identity',
                'User',
                '--evidence',
                'Approved corrected scope.',
            )
        ).code,
    ).toBe(1);
    expect(f.records.gate(f.id).current).toBe(false);
    f.records.recordDisplayedGate(displayed, displayed.approvalDigest, 'User', 'Board approval.');
    expect(f.records.gate(f.id).current).toBe(true);
}, 15000);

it('keeps amended scope history, invalidates old approval and refuses stale or invalid captures atomically', async () => {
    const f = await fixture();

    await f.confirm();
    f.records.setBody(f.id, 2, 'brief', scopeMarkdown(scope));
    f.records.recordGate(f.id, 3, {
        briefDigest: f.records.gate(f.id).briefDigest!,
        approvedBy: 'User',
        evidence: 'yes',
    });
    expect(f.records.gate(f.id).current).toBe(true);
    writeFileSync(f.file, JSON.stringify({ ...scope, excluded: [...scope.excluded, 'No new flags.'] }));

    const reviewed = f.records.doubtPackage(f.id);

    f.records.recordDoubt(f.id, reviewed.packageDigest, 'Doubt', 'Scope checked.');

    const before = f.records.read(f.id).revision;

    expect((await f.confirm(1)).code).toBe(1);
    expect(f.records.read(f.id).revision).toBe(before);
    expect((await f.confirm()).code).toBe(0);
    expect(f.records.gate(f.id)).toMatchObject({ current: false, evidence: [expect.any(Object)] });
    expect(f.records.currentDoubt(f.id)).toBeNull();
    expect(f.records.doubtPackage(f.id).packageDigest).not.toBe(reviewed.packageDigest);
    expect(f.records.briefScopeCheck(f.id).missing).toContainEqual({ field: 'scope.excluded', value: 'No new flags.' });
    expect(() => f.records.writeRevision(f.id, before, ['confirmedScope'])).toThrow(
        'conflicting fields: confirmedScope',
    );
    expect(f.records.initialContext(f.id)).toBe('Only cli.js and test/cli.test.js. Small.');
    writeFileSync(f.file, '{invalid json');
    expect((await f.confirm()).code).toBe(1);
    expect(f.records.read(f.id).revision).toBe(before + 1);

    const other = f.records.create({ title: 'Other', repository: 'example/product', kind: 'feature' });

    expect((await f.cli('confirmed-scope', other.workId)).code).toBe(1);
}, 15000);
