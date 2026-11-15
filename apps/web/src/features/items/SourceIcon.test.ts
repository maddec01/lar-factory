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

/** The source mark's name in `el`, among its other icons such as the kind mark. */
const sourceIn = (el: Element | null) =>
    [...(el?.querySelectorAll('[role="img"]') ?? [])]
        .map((icon) => icon.getAttribute('aria-label'))
        .find((label) => label?.includes('Saved'));

// On a board that saves only to GitHub, a GitHub ticket's mark would say the same everywhere, so the local mark goes.
test.each<[Item['status'], string, number, string, string | undefined]>([
    ['List', 'example/product', 17, 'https://github.com/example/product/issues/17', undefined],
    [
        'List',
        'example/project/product',
        23,
        'https://dev.azure.com/example/project/_workitems/edit/23',
        'Azure DevOps work item. Saved in Azure DevOps.',
    ],
    ['Verify', 'example/product', 17, 'https://github.com/example/product/issues/17', undefined],
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

    const row = $<HTMLElement>(status === 'List' ? '[data-list-modal] button[data-item]' : '.desk-row')!;

    expect(sourceIn(row)).toBe('Saved only on this machine.');
    // A desk row opens from its open button, which spans the row up to its actions.
    await settle(() => (row.querySelector<HTMLButtonElement>('[data-row-open]') ?? row).click());
    expect(sourceIn($('[data-item-summary]'))).toBe('Saved only on this machine.');
    await push(board({ ...item, number, url }));
    expect(sourceIn(row)).toBe(label);
    expect(sourceIn($('[data-item-summary]'))).toBe(label);
});
