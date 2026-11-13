import { defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { writeFactorySettings } from './factory-settings.ts';
import { MIGRATIONS } from './migrations.ts';
import { selectReviewers } from './reviewer-selection.ts';
import { openWorkRecords, workRecordsPath, type NewReviewRound } from './work-records.ts';

const dirs: string[] = [];
const neutralDiff = { complete: true, files: [{ path: 'src/helper.ts', text: 'verifyCaller();' }] };
const escalation = {
    requestedBy: 'code' as const,
    reason: 'verifyCaller changes authentication behind a neutral name.',
};
const request = { reviewer: 'security', ...escalation };
const code = { axis: 'code', verdict: 'approve' as const, findings: [] };
const security = { axis: 'security', verdict: 'approve' as const, findings: [], escalation };

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('upgrades existing review history without changing its verdicts or findings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-escalation-'));

    dirs.push(dir);

    const path = workRecordsPath(dir);
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 24) });

    old.db.exec(`
        INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at)
        VALUES ('old-work','test/repo','build','Review',1,'2026-01-01','2026-01-01');
        INSERT INTO review_rounds(work_id,round,base,recorded_at) VALUES ('old-work',1,'abc1234','2026-01-01');
        INSERT INTO review_axes(work_id,round,axis,verdict) VALUES ('old-work',1,'code','changes');
        INSERT INTO review_findings(work_id,round,axis,finding,severity,summary,disposition)
        VALUES ('old-work',1,'code',1,'should','Fix the check.','fixed');
    `);
    old.close();

    const records = await openWorkRecords(path);

    try {
        expect(records.reviewRounds('old-work')).toEqual([
            {
                round: 1,
                base: 'abc1234',
                recordedAt: '2026-01-01',
                reviewers: [
                    {
                        axis: 'code',
                        verdict: 'changes',
                        notChecked: null,
                        findings: [
                            { severity: 'should', summary: 'Fix the check.', disposition: 'fixed', reason: null },
                        ],
                    },
                ],
            },
        ]);
        records.recordReviewRound('old-work', 1, { base: 'def1234', reviewers: [code, security] });
        expect(records.reviewRounds('old-work')[1]!.reviewers[1]!.escalation).toEqual(escalation);
    } finally {
        records.close();
    }
});

it('adds the missed reviewer with Code provenance, retaining the original trigger evidence without mutating input', () => {
    const settings = defaultFactorySettings();
    const before = structuredClone({ settings, neutralDiff, request });
    const original = selectReviewers(settings, neutralDiff).find((entry) => entry.id === 'security');
    const selected = selectReviewers(settings, neutralDiff, [request]);

    expect(original).toMatchObject({ run: false, outcome: 'unmatched' });
    expect(selected.find((entry) => entry.id === 'security')).toMatchObject({
        run: true,
        escalation,
        outcome: original!.outcome,
        rule: original!.rule,
        evidence: original!.evidence,
    });
    expect({ settings, neutralDiff, request }).toEqual(before);
});

it('never escalates to a never reviewer and never adds a duplicate run for an already selected reviewer', () => {
    const settings = defaultFactorySettings();

    settings.reviewers.find((entry) => entry.id === 'security')!.mode = { kind: 'never' };
    expect(selectReviewers(settings, neutralDiff, [request]).find((entry) => entry.id === 'security')).toMatchObject({
        run: false,
        rule: 'mode.never',
        escalation: undefined,
    });
    settings.reviewers.find((entry) => entry.id === 'security')!.mode = { kind: 'always' };
    expect(selectReviewers(settings, neutralDiff, [request]).filter((entry) => entry.escalation)).toEqual([]);

    const duplicated = selectReviewers(defaultFactorySettings(), neutralDiff, [request, request]);

    expect(duplicated.filter((entry) => entry.escalation)).toHaveLength(1);
    expect(duplicated.filter((entry) => entry.id === 'security' && entry.run)).toHaveLength(1);
    expect(
        selectReviewers(defaultFactorySettings(), { complete: true, files: [{ path: 'auth.ts', text: '' }] }, [
            request,
        ]).filter((entry) => entry.escalation),
    ).toEqual([]);
});

it('rejects malformed requests, unknown targets and requests from an unselected or different reviewer', () => {
    for (const requests of [
        null,
        {},
        [null],
        [{ ...request, reason: ' ' }],
        [{ ...request, requestedBy: 'ui' }],
        [{ ...request, reviewer: 'missing' }],
    ])
        expect(() => selectReviewers(defaultFactorySettings(), neutralDiff, requests)).toThrow(/escalation/i);

    const settings = defaultFactorySettings();

    settings.reviewers.find((entry) => entry.id === 'code')!.mode = { kind: 'never' };
    expect(() => selectReviewers(settings, neutralDiff, [request])).toThrow('selected Code');
});

it('persists escalation provenance across reopen, including a saved custom reviewer, and preserves ordinary rounds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-escalation-'));

    dirs.push(dir);

    const settings = defaultFactorySettings();

    settings.reviewers.push({
        id: 'compatibility',
        name: 'Compatibility',
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text: 'Check compatibility.' }],
        mode: {
            kind: 'on-trigger',
            trigger: { version: 1, kind: 'rules', any: [{ target: 'path-glob', pattern: 'api/**' }] },
        },
    });
    writeFactorySettings(settings, dir);

    const selected = selectReviewers(settings, neutralDiff, [{ ...request, reviewer: 'compatibility' }]);
    const custom = selected.find((entry) => entry.id === 'compatibility')!;
    const records = await openWorkRecords(workRecordsPath(dir));
    let id: string;

    try {
        id = records.create({ repository: 'test/repo', kind: 'feature', title: 'Test' }).workId;
        records.recordReviewRound(id, 1, {
            base: 'abc1234',
            reviewers: [code, security, { ...security, axis: custom.id, escalation: custom.escalation }],
        });
        records.recordReviewRound(id, 2, { base: 'def1234', reviewers: [code] });
    } finally {
        records.close();
    }

    const reopened = await openWorkRecords(workRecordsPath(dir));

    try {
        expect(reopened.reviewRounds(id)[0]!.reviewers).toEqual([
            { ...code, notChecked: null },
            { ...security, notChecked: null },
            { ...security, axis: 'compatibility', notChecked: null },
        ]);
        expect(reopened.reviewRounds(id)[1]!.reviewers).toEqual([{ ...code, notChecked: null }]);
    } finally {
        reopened.close();
    }
});

it('refuses invalid or never escalations atomically at the record boundary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-escalation-'));

    dirs.push(dir);

    const records = await openWorkRecords(workRecordsPath(dir));

    try {
        const record = records.create({ repository: 'test/repo', kind: 'feature', title: 'Test' });
        const invalidRounds = [
            [security],
            [code, { ...security, escalation: { ...escalation, reason: '' } }],
            [code, { ...security, escalation: { ...escalation, requestedBy: 'ui' } }],
            [code, { ...security, verdict: 'skipped', notChecked: 'Skipped' }],
            [{ ...code, verdict: 'skipped', notChecked: 'Skipped' }, security],
            [{ ...code, escalation }],
            [code, security, security],
        ];

        for (const reviewers of invalidRounds) {
            expect(() =>
                records.recordReviewRound(record.workId, 1, { base: 'abc1234', reviewers } as NewReviewRound),
            ).toThrow(expect.objectContaining({ code: 'invalid' }));
            expect(records.reviewRounds(record.workId)).toEqual([]);
            expect(records.read(record.workId)).toEqual(record);
        }
        for (const id of ['code', 'security']) {
            const settings = defaultFactorySettings();

            settings.reviewers.find((entry) => entry.id === id)!.mode = { kind: 'never' };
            writeFactorySettings(settings, dir);
            expect(() =>
                records.recordReviewRound(record.workId, 1, { base: 'abc1234', reviewers: [code, security] }),
            ).toThrow('never');
            expect(records.reviewRounds(record.workId)).toEqual([]);
            expect(records.read(record.workId)).toEqual(record);
        }
    } finally {
        records.close();
    }
});
