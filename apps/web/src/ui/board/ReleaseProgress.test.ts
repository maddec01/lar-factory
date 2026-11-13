import type { ReleasePlan } from '@lar-factory/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';

import { ReleaseProgress } from './ReleaseProgress';

test('shows ordered release ownership, done evidence, failed Outcome and remaining work', () => {
    const plan: ReleasePlan = {
        steps: [
            {
                id: 'stage',
                who: 'Agent',
                what: 'Stage the merged bundle',
                done: { by: 'Builder', at: 'now', evidence: 'Manifest SHA256 receipt' },
            },
            { id: 'activate', who: 'Pedro', what: 'Activate the accepted manifest', done: null },
        ],
        outcomeCheck: {
            what: 'Check the delivered greeting',
            result: 'failed',
            evidence: { by: 'Pedro', at: 'now', evidence: 'Legacy behaviour failed' },
        },
    };
    const root = document.createElement('div');

    root.innerHTML = renderToStaticMarkup(
        createElement(ReleaseProgress, { plan, remaining: ['Activation is still pending.'] }),
    );

    const text = root.textContent!;

    expect(text.indexOf('1. Agent')).toBeLessThan(text.indexOf('2. Pedro'));
    for (const value of [
        'Done',
        'Manifest SHA256 receipt',
        'Pending',
        'Activate the accepted manifest',
        'failed',
        'Legacy behaviour failed',
        "What's left",
        'Activation is still pending.',
    ])
        expect(text).toContain(value);
    expect(text).not.toContain('Delivery complete');
});
