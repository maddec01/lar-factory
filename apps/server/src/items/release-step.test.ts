import type { Item } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createReleaseStep } from './release-step.ts';

test('board records Pedro evidence and clears the parent hold; refuses stale, empty, agent-owned and repeated submissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-release-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const parent = records.create({ title: 'Deliver labels', repository: 'fake/app', kind: 'concept' });
        const id = parent.workId;
        const revision = () => records.read(id).revision;

        records.setReleasePlan(id, revision(), {
            steps: [
                { id: 'stage', who: 'Agent', what: 'Stage' },
                { id: 'activate', who: 'Pedro', what: 'Activate' },
            ],
            outcomeCheck: 'Check composition',
        });

        const board = createBoardState({ items: [{ id } as Item], repos: [], firstRead: { settled: true } } as never);
        const reread = vi.fn();
        const commands = createReleaseStep({ board, records, reread });
        const submit = (input: object) =>
            commands.completeReleaseStep(id, {
                stepId: 'activate',
                revision: revision(),
                evidence: 'Activated manifest 123.',
                ...input,
            });

        expect((await submit({ stepId: 'stage' })).status).toBe(409);
        expect((await submit({})).status).toBe(409);
        records.completeReleaseStep(id, revision(), 'stage', 'Builder', 'Staged.');
        expect((await submit({ revision: revision() - 1 })).status).toBe(409);
        for (const evidence of ['', ' ', 'a'.repeat(1001), null]) expect((await submit({ evidence })).status).toBe(409);
        expect((await submit({ by: 'Agent' })).status).toBe(200);
        expect(records.releasePlan(id)?.steps[1]?.done).toMatchObject({
            by: 'Pedro',
            evidence: 'Activated manifest 123.',
        });
        expect(records.completion(id).reasons.join(' ')).not.toContain('Release step activate');
        expect((await submit({})).status).toBe(409);
        expect(reread).toHaveBeenCalledTimes(1);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
