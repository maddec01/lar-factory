import type { ReleasePlan } from '@lar-factory/shared';
import { TooltipProvider } from '@lar-works/design-system';
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
                done: { by: 'Builder', at: 'now', evidence: `Manifest SHA256 ${'a'.repeat(64)}` },
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
        createElement(
            TooltipProvider,
            null,
            createElement(ReleaseProgress, { plan, remaining: ['Activation is still pending.'] }),
        ),
    );

    const text = root.textContent!;

    expect(text.indexOf('Stage the merged bundle')).toBeLessThan(text.indexOf('Activate the accepted manifest'));
    for (const value of [
        'Done',
        'Manifest SHA256 aaaaaaaaaaaa…',
        'Pending',
        'Activate the accepted manifest',
        'failed',
        'Legacy behaviour failed',
        "What's left",
        'Activation is still pending.',
    ])
        expect(text).toContain(value);
    expect(text).not.toContain('Delivery complete');
    expect(text).not.toContain('a'.repeat(64));
    expect(root.querySelector('time')?.dateTime).toBe('now');
    expect(root.querySelectorAll('ol[aria-label="Release steps"] li')).toHaveLength(2);
    expect(root.querySelector('[aria-label="Copy full release evidence"]')).not.toBeNull();
});
