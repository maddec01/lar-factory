import { assert, describe, it } from '@effect/vitest';

import * as Machine from './updateMachine.ts';

const at = '2026-10-23T09:00:00Z';
const notes = [{ version: '0.3.0', items: ['feat(board): keep the button'], totalItems: 1 }];
const available = Machine.reduceOnUpdateAvailable(
    Machine.createBaseUpdateState('0.2.0', 'latest', null),
    '0.3.0',
    at,
    notes,
    2,
);
const downloaded = Machine.reduceOnDownloadComplete(available, '0.3.0');

describe('a check with an update downloaded', () => {
    it('keeps the notes, and stays downloaded when it fails', () => {
        const checking = Machine.reduceOnCheckStart(downloaded, at);

        assert.deepStrictEqual(checking.releaseNotes, notes);
        assert.strictEqual(checking.downloadPercent, 100);

        const failed = Machine.reduceOnCheckFailure(checking, 'offline', at);

        assert.strictEqual(failed.status, 'downloaded');
        assert.isNull(failed.errorContext);
        assert.isTrue(failed.canRetry);
    });
});

describe('a background error', () => {
    it('keeps a downloaded update', () => {
        const state = Machine.reduceOnBackgroundError(downloaded, 'feed unreadable', at);

        assert.strictEqual(state.status, 'downloaded');
        assert.isNull(state.message);
    });
});
