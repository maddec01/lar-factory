import {
    buildsAtWork,
    limitNumber,
    deskItems,
    groupState,
    itemActivityThread,
    type BoardData,
} from '@lar-factory/shared';
import fixture from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createSampleBoard } from './sample-board.ts';

test('fake delivery exercises stale approval, grouped Auto-build and current build activity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'delivery-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(structuredClone(fixture) as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const reply = await sample.sampleControl({ action: 'delivery' });
        const parent = board.find((reply.body as { workId: string }).workId)!;

        expect(buildsAtWork(board.snapshot()).length).toBeLessThanOrEqual(limitNumber(board.snapshot().buildLimit!));
        expect(groupState(parent, board.snapshot())?.word).toBe('2 builds running · 1 waiting');

        const stale = board.snapshot().items.find((item) => item.staleGate)!;

        expect(deskItems(board.snapshot(), false)).toContain(stale);
        expect(stale.briefApproval?.reason).toBe('Brief changed. Review and approve the current product content.');

        const building = board.snapshot().items.find((item) => item.parentId === parent.id && item.buildPhase)!;

        expect(itemActivityThread(building)?.purpose).toBe('build');

        const overridden = await sample.sampleControl({ action: 'delivery', change: 'manual-override' });

        expect(overridden.status).toBe(200);
        expect(buildsAtWork(board.snapshot())).toHaveLength(3);
        expect(limitNumber(board.snapshot().buildLimit!)).toBe(2);

        const manual = board.find((overridden.body as { manualWorkId: string }).manualWorkId)!;

        expect(manual.buildStarted).toBe(true);
        expect(manual.buildReserved).toBe(true);
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('growing-concept sample exposes twenty active builds, retired history, long decision and owner navigation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'growing-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(structuredClone(fixture) as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const { body } = await sample.sampleControl({ action: 'growing-concept' });
        const parent = board.find((body as { workId: string }).workId)!;

        expect(parent.conceptBuild?.members.filter((member) => member.kind === 'build')).toHaveLength(20);
        expect(parent.retiredParts?.map((item) => item.title.slice(0, 3))).toEqual(['b04', 'b06']);
        expect(parent.retiredParts?.[0]?.supersededBy?.title).toContain('b05');
        expect(parent.threads).toMatchObject([{ id: 'sample-concept-owner' }]);

        const first = board.snapshot().items.find((item) => item.parentId === parent.id)!;

        expect(await sample.itemDetails.details(first)).toMatchObject({
            record: { body: expect.stringContaining('<fragment>') },
        });
        expect((await sample.sampleControl({ action: 'growing-concept' })).body).toEqual(body);
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the fake Verify head can wait and resume without inventing missing Test steps or delivery evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pending-head-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(structuredClone(fixture) as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const reply = await sample.sampleControl({ action: 'verification', change: 'seed' });
        const id = (reply.body as { workId: string }).workId;

        await sample.sampleControl({ action: 'verification', change: 'hold-head' });

        const pending = sample.commands.inspectVerification(id);

        expect((await sample.commands.inspectVerification(id)).body).toMatchObject({ verificationPending: true });
        expect(board.find(id)?.verification?.latest).toBeNull();
        await sample.sampleControl({ action: 'verification', change: 'release-head' });
        expect((await pending).body).toMatchObject({
            verification: { testSteps: expect.stringContaining('Press Say hello') },
        });
        expect(board.find(id)?.verification?.latest).toBeNull();
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('fake amended-brief controls preserve a saved notice while approval waits for Doubt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-review-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(structuredClone(fixture) as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const pending = await sample.sampleControl({ action: 'brief-approval', change: 'doubt-pending' });
        const id = (pending.body as { workId: string }).workId;
        const reviewing = board.find(id)!;

        expect(reviewing.briefReviewing).toBe(true);
        expect(reviewing.briefApproval).toBeUndefined();
        expect(reviewing.needsYou?.reason).toBe('Should narrow layouts wrap the greeting or preserve one line?');
        expect(deskItems(board.snapshot(), false)).toContain(reviewing);
        expect(await sample.itemDetails.details(reviewing)).toMatchObject({ spec: { outdated: true } });
        await sample.sampleControl({ action: 'brief-approval', change: 'doubt-ready' });
        expect(board.find(id)?.briefApproval?.digest).toBeTruthy();
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('failed Outcome sample offers a writable fix proposal without contacting T3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(structuredClone(fixture) as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const reply = await sample.sampleControl({ action: 'failed-outcome' });
        const parent = board.find((reply.body as { workId: string }).workId)!;

        expect(parent.releasePlan?.outcomeCheck.result).toBe('failed');
        expect(deskItems(board.snapshot(), false).filter((item) => item.id === parent.id)).toHaveLength(1);

        const result = await sample.commands.proposeOutcomeFix(parent.id, {
            revision: parent.revision,
            inputDigest: parent.outcomeCheck!.digest,
        });

        expect(result.status).toBe(200);
        expect(board.find(parent.id)?.outcomeCheck?.run?.fixProposal?.sent).toBe(true);
        expect(board.find(parent.id)?.releasePlan?.outcomeCheck.result).toBe('failed');
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
