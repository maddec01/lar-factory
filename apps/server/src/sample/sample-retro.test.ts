import { deskItems, type BoardData } from '@lar-factory/shared';
import fixture from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createSampleBoard } from './sample-board.ts';

test('writable fake sample records picks and creates exactly their fake issues without T3 or real providers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-sample-test-'));

    vi.stubEnv('LAR_FACTORY_DATA_DIR', dir);

    const board = createBoardState(fixture as unknown as BoardData);
    const sample = await createSampleBoard(board, fixture as unknown as BoardData);

    try {
        const seed = await sample.sampleControl({ action: 'retro', change: 'seed' });

        expect(seed.status).toBe(200);

        const id = (seed.body as { workId: string }).workId;
        const item = board.find(id)!;

        expect(item.status).toBe('Done');
        expect(item.retro?.suggestions).toHaveLength(2);
        expect(deskItems(board.snapshot(), false).filter((i) => i.id === id)).toHaveLength(1);

        const result = await sample.commands.chooseRetro(id, { revision: item.revision, selected: [0] });

        expect(result.status).toBe(200);
        expect(board.find(id)?.retro?.captures[0]).toMatchObject({ complete: true, error: null });

        const capture = board.find(board.find(id)!.retro!.captures[0]!.workId!)!;

        expect(capture.status).toBe('List');
        expect(capture.number).toBeGreaterThan(0);
        expect(capture.url).toContain('lar-factory-sample/');
        expect(capture.title).toBe('Explain reviewer evidence in command help');
        await sample.commands.retryRetro(id);
        expect(board.snapshot().items.filter((i) => i.title === capture.title)).toHaveLength(1);
        expect(deskItems(board.snapshot(), false).some((i) => i.id === id)).toBe(false);
    } finally {
        sample.close();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
