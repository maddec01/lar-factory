import { deskWait, questionWaitReason } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createOutcomeCheck } from './outcome-check.ts';
import { recordItems } from './record-items.ts';
import { createReleaseStep } from './release-step.ts';

test('board approval settles only the duplicate T3 question and durably resumes activation once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-owner-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const id = records.create({ title: 'Greeting', repository: 'fake/app', kind: 'concept' }).workId;
        const at = () => records.read(id).revision;

        records.setFogGone(id, at(), true);

        records.addThread(id, at(), 'owner', 'shape');

        const part = records.createPart({
            parentId: id,
            parentRevision: at(),
            title: 'Part',
            repository: 'fake/app',
            kind: 'build',
            body: 'Part',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, 'fake/app#1');
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        records.setReleasePlan(id, at(), {
            steps: [
                { id: 'approve', who: 'User', what: 'Approve activation of exact manifest' },
                { id: 'activate', who: 'Agent', what: 'Activate approved manifest' },
            ],
            outcomeCheck: 'Actual composition',
        });

        const summary =
            'Q2 - Joint sandbox activation: Approve activating the staged artifacts together? Manifest SHA256 abc.';
        const owner = {
            id: 'owner',
            title: 'Release',
            state: 'needs you' as const,
            updated: '2026-11-14T12:00:00Z',
            purpose: 'shape',
            questionSummary: summary,
            pendingRequest: { id: 'q2', threadId: 'owner', kind: 'question' as const },
        };
        const items = () =>
            recordItems(records, [], ['fake/app']).map((item) =>
                item.id === id ? { ...item, threads: [owner] } : item,
            );
        const board = createBoardState({ items: items(), repos: [{ repo: 'fake/app' }] } as never);
        const reread = () => board.update({ items: items() });
        const send = vi
            .fn()
            .mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Lost response' })
            .mockResolvedValue({ outcome: 'accepted', sequence: 1 });
        const readProjection = vi.fn().mockResolvedValue({
            thread: { id: 'owner' },
            runtimeRequests: [{ id: 'q2', kind: 'user_input', status: 'pending' }],
            turnItems: [{ type: 'user_input_request', requestId: 'q2', questions: [{ id: '0', question: summary }] }],
        });
        const create = () => createReleaseStep({ board, records, reread, send, readProjection });
        const before = board.find(id)!;

        expect(deskWait(before, false, board.snapshot().items).action?.label).toBe('Mark release step done');
        expect(questionWaitReason(before)).toMatch(/superseded.*board/i);
        expect(
            (
                await create().completeReleaseStep(id, {
                    revision: at(),
                    stepId: 'approve',
                    evidence: 'The user approved manifest SHA256 abc, exact A/B/C SHAs.',
                })
            ).status,
        ).toBe(200);
        expect(send).toHaveBeenCalledTimes(1);

        const restarted = create();

        await restarted.reconcileReleaseContinuations();
        await restarted.reconcileReleaseContinuations();
        expect(send).toHaveBeenCalledTimes(3);
        expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
        expect(send.mock.calls[1]![0]).toMatchObject({
            type: 'runtime-request.respond',
            requestId: 'q2',
            answers: { '0': expect.stringContaining('The user approved manifest SHA256 abc') },
        });
        expect(send.mock.calls[2]![0]).toMatchObject({
            type: 'message.dispatch',
            threadId: 'owner',
            text: expect.stringContaining('activate'),
        });
        expect(send.mock.calls[2]![0].text).toContain(
            'End the turn after the last release receipt; do not measure or record Outcome',
        );
        expect(deskWait(board.find(id)!, false, board.snapshot().items).action?.label).not.toBe('Answer in T3');
        expect(records.releasePlan(id)?.steps[1]?.done).toBeNull();

        expect((await restarted.resumeRelease(id, { revision: at() - 1 })).status).toBe(409);
        readProjection.mockResolvedValue({
            thread: { id: 'owner' },
            runtimeRequests: [],
            turnItems: [],
            runs: [{ status: 'running' }],
        });
        expect((await restarted.resumeRelease(id, { revision: at() })).status).toBe(409);
        expect(send).toHaveBeenCalledTimes(3);
        readProjection.mockResolvedValue({
            thread: { id: 'owner' },
            runtimeRequests: [],
            turnItems: [],
            runs: [{ status: 'completed' }],
        });
        expect((await restarted.resumeRelease(id, { revision: at() })).status).toBe(200);
        expect(send).toHaveBeenCalledTimes(4);
        await restarted.reconcileReleaseContinuations();
        expect(send).toHaveBeenCalledTimes(4);

        const beforeActivation = records.outcomeCheck(id).digest;

        await createOutcomeCheck({ board, records, reread, send }).reconcileOutcomeChecks();
        expect(records.outcomeCheck(id).run).toBeNull();

        const dispatches = send.mock.calls.length;

        // Only measured activation evidence unlocks Outcome; the board approval alone never completes delivery.
        records.completeReleaseStep(id, at(), 'activate', 'Release owner', 'Activated exact approved manifest abc.');
        reread();
        expect(records.prepareOutcomeCheck(id).ready).toBe(true);
        await createOutcomeCheck({ board, records, reread, send }).reconcileOutcomeChecks();

        const outcome = records.outcomeCheck(id).run!;

        expect(outcome.digest).not.toBe(beforeActivation);
        expect(send.mock.calls).toHaveLength(dispatches + 1);
        expect(send.mock.calls.at(-1)![0].text).toContain(`--input-digest ${outcome.digest}`);
        expect(() => records.recordOutcomeCheck(id, at(), 'passed', 'Owner', 'Missing digest')).toThrow(/input-digest/);
        expect(() => records.recordOutcomeCheck(id, at(), 'passed', 'Owner', 'Stale input', beforeActivation)).toThrow(
            /composition changed/,
        );

        expect(send.mock.calls.at(-1)![0]).toMatchObject({
            type: 'message.dispatch',
            threadId: 'owner',
            text: expect.stringContaining('final Outcome check'),
        });
        expect(records.completion(id).complete).toBe(false);
        records.recordOutcomeCheck(
            id,
            at(),
            'passed',
            'Release owner',
            'Exact merged SHA composition and legacy checks passed.',
            outcome.digest,
        );
        await createOutcomeCheck({ board, records, reread, send }).reconcileOutcomeChecks();
        expect(records.read(id).status).toBe('Done');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a user release step waits until every part is built', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-parts-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const id = records.create({ title: 'Ties', repository: 'fake/app', kind: 'concept' }).workId;
        const at = () => records.read(id).revision;

        records.setFogGone(id, at(), true);

        const part = records.createPart({
            parentId: id,
            parentRevision: at(),
            title: 'Part',
            repository: 'fake/app',
            kind: 'build',
            body: 'Part',
            blockerIds: [],
        });

        records.setReleasePlan(id, at(), {
            steps: [{ id: 'deploy', who: 'User', what: 'Deploy the service' }],
            outcomeCheck: 'Ties are broken',
        });

        const board = createBoardState({
            items: recordItems(records, [], ['fake/app']),
            repos: [{ repo: 'fake/app' }],
        } as never);
        const reread = () => board.update({ items: recordItems(records, [], ['fake/app']) });
        const release = createReleaseStep({ board, records, reread, send: vi.fn(), readProjection: vi.fn() });
        const complete = () => release.completeReleaseStep(id, { revision: at(), stepId: 'deploy', evidence: 'Done.' });

        expect(deskWait(board.find(id)!, false, board.snapshot().items).label).not.toBe('Release step');
        expect(await complete()).toMatchObject({
            status: 409,
            body: { error: expect.stringMatching(/every part is built/) },
        });

        records.setPullRequest(part.workId, part.revision, 'fake/app#1');
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        reread();

        expect(deskWait(board.find(id)!, false, board.snapshot().items).label).toBe('Release step');
        expect((await complete()).status).toBe(200);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
