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
