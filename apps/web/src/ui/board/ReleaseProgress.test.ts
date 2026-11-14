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
            createElement(ReleaseProgress, {
                plan,
                remaining: ['Activation is still pending.', 'Outcome check pending.'],
            }),
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
    expect([...root.querySelectorAll('ul[aria-label="What\'s left"] li')].map((node) => node.textContent)).toEqual([
        'Activation is still pending.',
        'Outcome check pending.',
    ]);
    expect(root.querySelector('time')?.dateTime).toBe('now');
    expect(root.querySelectorAll('ol[aria-label="Release steps"] li')).toHaveLength(2);
    expect(root.querySelector('[aria-label="Copy full release evidence"]')).not.toBeNull();
});

test('ships-with links and delivery holds identify the affected parts by name', () => {
    const server = '11111111-1111-4111-8111-111111111111';
    const app = '22222222-2222-4222-8222-222222222222';
    const plan: ReleasePlan = {
        steps: [
            {
                id: 'together',
                who: 'Pedro',
                what: 'Ship the invitation link contract',
                shipsWith: [server, app],
                done: null,
            },
        ],
        outcomeCheck: { what: 'Invitations open the app.', result: 'pending', evidence: null },
    };
    const names = (id: string) => (id === server ? 'Update server links' : 'Read invitation links in the app');
    const root = document.createElement('div');

    root.innerHTML = renderToStaticMarkup(
        createElement(ReleaseProgress, {
            plan,
            name: names,
            remaining: ["Its Fog isn't gone.", `Its build ${app} isn't Done.`],
        }),
    );
    expect(root.textContent).toContain('Ships with: Update server links + Read invitation links in the app');
    expect(root.querySelector('summary')?.textContent).toContain('1 part not built yet');
    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('details li')?.textContent).toBe('Read invitation links in the app');
    expect(root.textContent).toContain('Open questions still need answers.');
    expect(root.textContent).not.toContain('Fog');
    expect(root.textContent).toContain('Pedro · Pending');
    expect(root.textContent).not.toContain(app);
    expect(root.textContent).not.toContain(server);
});

test('ten unfinished builds fold into one summary beside the questions, release and Outcome holds', () => {
    const root = document.createElement('div');

    root.innerHTML = renderToStaticMarkup(
        createElement(ReleaseProgress, {
            plan: {
                steps: [{ id: 'ship', who: 'Pedro', what: 'Ship together', done: null }],
                outcomeCheck: { what: 'Links open', result: 'pending', evidence: null },
            },
            remaining: [
                "Its Fog isn't gone.",
                'Release step ship: Pedro must Ship together',
                'Outcome check pending: Links open',
                ...Array.from({ length: 10 }, (_, i) => `Its build part-${i} isn't Done.`),
            ],
            name: (id) => id,
        }),
    );
    expect(root.querySelector('summary')?.textContent).toContain('10 parts not built yet');
    expect(root.querySelectorAll('details li')).toHaveLength(10);
    expect(root.querySelectorAll('ul[aria-label="What\'s left"] > li')).toHaveLength(4);
    expect(root.textContent).toContain('Ship together · Pedro');
    expect(root.textContent).toContain('Outcome check pending');
    expect(root.textContent!.split('Links open')).toHaveLength(2);
});
