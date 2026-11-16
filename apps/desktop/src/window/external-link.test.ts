import { assert, describe, it } from '@effect/vitest';

import * as ExternalLink from './external-link.ts';

describe('ExternalLink', () => {
    it("opens no T3 Code link but a thread, and nothing for other schemes or a URL that doesn't parse", () => {
        for (const target of [
            't3code://projects/add?path=/etc',
            't3code://threads.evil/env-1/thread-1',
            'file:///etc/passwd',
            'javascript:alert(1)',
            'smb://host/share',
            'x-apple.systempreferences:',
            'not a url',
            '',
        ]) {
            assert.isUndefined(ExternalLink.outsideUrl(target), target);
        }
    });
});
