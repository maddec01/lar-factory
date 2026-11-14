import type { BoardData, Item } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createOutcomeCheck } from './outcome-check.ts';
import { recordItems } from './record-items.ts';

test('board Outcome receipt rejects stale/invalid input, fixes its actor and finishes both group kinds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-outcome-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        for (const kind of ['feature', 'concept'] as const) {
            const id = records.create({ title: 'Group', repository: 'fake/app', kind, status: 'In progress' }).workId;
            const at = () => records.read(id).revision;

            if (kind === 'concept') records.setFogGone(id, at(), true);

            const part = records.createPart({
                parentId: id,
                parentRevision: at(),
                title: 'Part',
                repository: 'fake/app',
                kind: 'build',
                body: 'Blocked by: none',
                blockerIds: [],
            });

            records.setPullRequest(part.workId, part.revision, 'fake/app#1');
            records.setReleasePlan(id, at(), { steps: [], outcomeCheck: 'Check composition.' });

            const board = createBoardState({ items: [{ id } as Item], repos: [{ repo: 'fake/app' }] } as BoardData);
            const commands = createOutcomeCheck({ board, records, reread: vi.fn() });
            const submit = (input: object = {}) =>
                commands.recordOutcomeCheck(id, {
                    revision: at(),
                    inputDigest: records.outcomeCheck(id).digest,
                    result: 'passed',
                    evidence: 'Composition at merged SHAs passed.',
                    ...input,
                });

            expect((await submit()).status).toBe(409);
            records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
            expect((await submit({ revision: at() - 1 })).status).toBe(409);
            expect((await submit({ inputDigest: 'stale' })).status).toBe(409);
            for (const evidence of ['', ' ', 'x'.repeat(1001), null])
                expect((await submit({ evidence })).status).toBe(409);
            expect((await submit({ result: 'yes' })).status).toBe(409);
            expect((await submit({ by: 'Agent' })).status).toBe(200);
            expect(records.releasePlan(id)?.outcomeCheck.evidence?.by).toBe('Pedro');
            expect(records.read(id).status).toBe('Done');
            expect((await submit()).status).toBe(409);
        }
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('lost Outcome dispatch responses retry after restart with exactly the same T3 identities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-dispatch-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const id = records.create({
            title: 'Group',
            repository: 'fake/app',
            kind: 'feature',
            status: 'In progress',
        }).workId;
        const at = () => records.read(id).revision;

        records.addThread(id, at(), 'owner', 'shape');

        const part = records.createPart({
            parentId: id,
            parentRevision: at(),
            title: 'Part',
            repository: 'fake/app',
            kind: 'build',
            body: 'Blocked by: none',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, 'fake/app#1');
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        records.setReleasePlan(id, at(), { steps: [], outcomeCheck: 'Check composition.' });

        const board = createBoardState({
            items: recordItems(records, [], ['fake/app']),
            repos: [{ repo: 'fake/app' }],
        } as BoardData);
        const send = vi
            .fn<NonNullable<Parameters<typeof createOutcomeCheck>[0]['send']>>()
            .mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Lost response' })
            .mockResolvedValue({ outcome: 'accepted', sequence: 1 });

        await createOutcomeCheck({ board, records, reread: vi.fn(), send }).reconcileOutcomeChecks();

        const restarted = createOutcomeCheck({ board, records, reread: vi.fn(), send });

        await restarted.reconcileOutcomeChecks();
        await restarted.reconcileOutcomeChecks();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]![0]).toMatchObject({ text: expect.stringContaining('local static HTTP server') });
        expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('failed Outcome dispatches a fix proposal only from the board action and reuses uncertain IDs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-fix-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const id = records.create({
            title: 'Linked greeting',
            repository: 'fake/app',
            kind: 'feature',
            status: 'In progress',
        }).workId;
        const at = () => records.read(id).revision;

        records.addThread(id, at(), 'owner', 'shape');

        const part = records.createPart({
            parentId: id,
            parentRevision: at(),
            title: 'C',
            repository: 'fake/app',
            kind: 'build',
            body: 'Blocked by: none',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, 'fake/app#1');
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        records.setReleasePlan(id, at(), { steps: [], outcomeCheck: 'B→C composition' });
        records.recordOutcomeCheck(id, at(), 'failed', 'Outcome owner', 'displayGreeting(element) has no B input.');

        const reread = () => board.update({ items: recordItems(records, [], ['fake/app']) });
        const board = createBoardState({
            items: recordItems(records, [], ['fake/app']),
            repos: [{ repo: 'fake/app' }],
        } as BoardData);
        const send = vi
            .fn<NonNullable<Parameters<typeof createOutcomeCheck>[0]['send']>>()
            .mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Lost response' })
            .mockResolvedValue({ outcome: 'accepted', sequence: 1 });
        const commands = createOutcomeCheck({ board, records, reread, send });

        await commands.reconcileOutcomeChecks();
        expect(send).not.toHaveBeenCalled();

        const request = () => ({ revision: at(), inputDigest: records.outcomeCheck(id).digest });

        expect((await commands.proposeOutcomeFix(id, { ...request(), revision: at() - 1 })).status).toBe(409);
        expect((await commands.proposeOutcomeFix(id, request())).status).toBe(409);

        const restarted = createOutcomeCheck({ board, records, reread, send });

        expect((await restarted.proposeOutcomeFix(id, request())).status).toBe(200);
        expect((await restarted.proposeOutcomeFix(id, request())).status).toBe(200);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
        expect(send.mock.calls[1]![0]).toMatchObject({
            threadId: 'owner',
            text: expect.stringContaining('create-parts'),
        });
        expect(send.mock.calls[1]![0]).toMatchObject({
            text: expect.stringContaining('displayGreeting(element) has no B input.'),
        });
        expect(records.releasePlan(id)?.outcomeCheck.result).toBe('failed');
        expect(records.children(id)).toHaveLength(1);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
