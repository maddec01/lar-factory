import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

import type { AccessRow } from './AccessList';
import { $, settle, text } from '@/test/PageTest';

test.each([
    ['team/app', 'Create issues', 'Edit issues'],
    ['org/project/repo', 'Create work items', 'Edit work items'],
])('access reasons use the %s operation names', async (repo, create, edit) => {
    const { AccessReason } = await import('./AccessList');

    document.body.replaceChildren();

    const host = document.body.appendChild(document.createElement('div'));

    await settle(() =>
        createRoot(host).render(
            createElement(AccessReason, {
                repo,
                reason: 'Access to publish-ticket is not checked yet. Access to edit-ticket was refused.',
            }),
        ),
    );
    expect(text(host)).toContain(`Access to ${create} is not checked yet.`);
    await settle(() => host.querySelector<HTMLButtonElement>('[aria-label="About access"]')!.click());
    expect(text(document.body)).toContain(`Access to ${edit} was refused.`);
    expect(text(document.body)).not.toMatch(/publish-ticket|edit-ticket/);
});

test('the shared list accepts a separate read row and the compact onboarding operations', async () => {
    const { AccessList, operationNames } = await import('./AccessList');
    const names = operationNames('team/app');
    const rows: AccessRow[] = [
        { name: 'Read issues', access: 'allowed' },
        { name: names['manage-labels'], access: 'refused' },
        { name: names['push-branch'], access: 'unverified' },
        { name: names['open-pr'], access: 'allowed' },
    ];
    const recheck = vi.fn();

    document.body.replaceChildren();

    const host = document.body.appendChild(document.createElement('div'));

    await settle(() => createRoot(host).render(createElement(AccessList, { rows, onRecheck: recheck })));
    expect([...host.querySelectorAll('.settings-row-title')].map(text)).toEqual([
        'Read issues',
        'Manage labels',
        'Push branches',
        'Open PRs',
    ]);
    expect([...host.querySelectorAll('.tool-state')].map(text)).toEqual([
        '● Allowed',
        '● Refused',
        '● Not checked',
        '● Allowed',
    ]);
    await settle(() => $<HTMLButtonElement>('[data-access] button')!.click());
    expect(recheck).toHaveBeenCalledOnce();
    expect(operationNames('org/project/repo')['type-ticket']).toBe('Set work item types');
});
