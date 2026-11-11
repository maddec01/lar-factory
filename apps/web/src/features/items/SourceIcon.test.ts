import type { BoardData, Item } from '@lar-factory/shared';
// Source names through the rendered board. DOM tests cover semantics and placement, not pixel layout.
import { expect, test } from 'vite-plus/test';

import { $, mountPage, push, sample, settle } from '@/test/PageTest';

const local: Item = {
    ...sample.items[0]!,
    id: 'source-work',
    repo: 'example/product',
    number: 0,
    url: null,
    title: 'Export a report',
    kind: 'feature',
    status: 'Verify',
    statuses: ['Verify'],
    parent: null,
    parentId: null,
    subIssues: { total: 0, completed: 0 },
    slices: [],
    blockers: [],
    linkedPrs: [],
};
const board = (item: Item): BoardData => ({
    ...sample,
    items: [item],
    repos: [{ repo: item.repo, role: '', labels: [] }],
});

test.each<[Item['status'], string, number, string, string]>([
    ['List', 'example/product', 17, 'https://github.com/example/product/issues/17', 'GitHub issue. Saved on GitHub.'],
    [
        'List',
        'example/project/product',
        23,
        'https://dev.azure.com/example/project/_workitems/edit/23',
        'Azure DevOps work item. Saved in Azure DevOps.',
    ],
    ['Verify', 'example/product', 17, 'https://github.com/example/product/issues/17', 'GitHub issue. Saved on GitHub.'],
    [
        'Verify',
        'example/project/product',
        23,
        'https://dev.azure.com/example/project/_workitems/edit/23',
        'Azure DevOps work item. Saved in Azure DevOps.',
    ],
])('conversion in %s updates %s and its open details without a reload', async (status, repo, number, url, label) => {
    const item: Item = { ...local, status, statuses: [status], repo };

    await mountPage(board(item));

    if (status === 'List') await settle(() => $<HTMLButtonElement>('.list-button')!.click());

    const row = $<HTMLElement>(status === 'List' ? '[data-list-modal] button[data-item]' : '.desk-card')!;

    expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
    // A desk card opens from its open button, stretched over the whole card.
    await settle(() => (row.querySelector<HTMLButtonElement>(':scope > [data-slot="action-overlay"]') ?? row).click());
    expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
    await push(board({ ...item, number, url }));
    expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(label);
    expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe(label);
});
