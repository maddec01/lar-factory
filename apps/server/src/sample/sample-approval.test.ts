import { deskItems, type BoardData } from '@lar-factory/shared';
import fixture from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createSampleBoard } from './sample-board.ts';

test('fake tool approval keeps its stage and exact owner, then clears without touching T3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'approval-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(fixture as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const seeded = await sample.sampleControl({ action: 'tool-approval', change: 'seed' });

        expect(seeded.status).toBe(200);

        const id = (seeded.body as { workId: string }).workId;

        expect(board.find(id)).toMatchObject({
            status: 'Shaping',
            threads: [
                {
                    pendingRequest: { kind: 'tool-approval', threadId: 'sample-approval-owner' },
                    questionSummary: 'Allow reading the sandbox fixture folder? Inspect the fake greeting page.',
                },
            ],
        });
        expect(deskItems(board.snapshot(), false).map((item) => item.id)).toContain(id);
        expect((await sample.sampleControl({ action: 'tool-approval', change: 'resolve' })).status).toBe(200);
        expect(board.find(id)).toMatchObject({ status: 'Shaping', threads: [{ state: 'running' }] });
        expect(deskItems(board.snapshot(), false).map((item) => item.id)).not.toContain(id);
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
