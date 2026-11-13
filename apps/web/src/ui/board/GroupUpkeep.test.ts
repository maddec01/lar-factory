import type { ReconcileReport } from '@lar-factory/shared/group-reconciliation';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';

import { GroupUpkeep } from './GroupUpkeep';

test('groups affected briefs by work ID, retaining equal titles without showing agent instructions', () => {
    const report: ReconcileReport = {
        groupId: 'group',
        digest: 'current',
        completed: [],
        items: Array.from({ length: 10 }, (_, index) => ({
            key: `doubt:${index}`,
            digest: 'changed',
            kind: 'brief',
            workId: String(index),
            summary: 'Repair the brief and rerun Doubt.',
            changes: ['contract'],
            requiresFix: true,
        })),
    };
    const root = document.createElement('div');

    root.innerHTML = renderToStaticMarkup(createElement(GroupUpkeep, { report, name: () => 'Reconnect' }));
    expect(root.querySelectorAll('summary')).toHaveLength(1);
    expect(root.querySelector('summary')?.textContent).toBe(
        '10 briefs to re-check: answers or sibling contracts changed',
    );
    expect(root.querySelectorAll('li')).toHaveLength(10);
    expect(root.textContent).not.toContain('rerun Doubt');
});
