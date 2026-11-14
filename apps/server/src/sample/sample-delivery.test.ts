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
        expect(stale.briefApproval?.reason).toBe('Gate out of date: brief changed since approval');

        const building = board.snapshot().items.find((item) => item.parentId === parent.id && item.buildPhase)!;

        expect(itemActivityThread(building)?.purpose).toBe('build');
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
