import type { Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

const base = { ...sample.items[0]!, kindDisagreement: undefined };
const group: Item = {
    ...base,
    id: 'delivery',
    kind: 'concept',
    flow: 'linked',
    status: 'Shaping',
    parentId: null,
    parent: null,
    threads: [],
    linkedPrs: [],
    subIssues: { total: 3, completed: 0 },
    completion: { complete: false, reasons: [] },
    title: 'Auto-build delivery',
};
const build = (index: number, status: Item['status']): Item => ({
    ...base,
    id: `build-${index}`,
    kind: 'build',
    flow: 'linked',
    parentId: group.id,
    parent: null,
    status,
    buildReserved: status !== 'Ready',
    linkedPrs: [],
    buildPhase: null,
    completion: { complete: false, reasons: [] },
    subIssues: { total: 0, completed: 0 },
    threads:
        index === 0
            ? [
                  {
                      id: 'old-shape',
                      title: 'Stale shaping owner',
                      purpose: 'shape',
                      state: 'needs you',
                      updated: '2026-10-21',
                  },
                  {
                      id: 'current-build',
                      title: 'Current build owner',
                      purpose: 'build',
                      state: 'running',
                      currentRunning: true,
                      updated: '2026-10-21',
                  },
              ]
            : [],
});

test('row, group details and expanded build header share Auto-build delivery status without explicit concept authorization', async () => {
    const parts = [build(0, 'In progress'), build(1, 'Review'), build(2, 'Ready')];
    const parent: Item = {
        ...group,
        threads: [
            {
                id: 'coordinator-question',
                title: 'Group release question',
                purpose: 'shape',
                state: 'needs you',
                updated: '2026-10-21',
                pendingRequest: { id: 'question', threadId: 'coordinator-question', kind: 'question' },
            },
        ],
        conceptBuild: {
            run: null,
            holds: [],
            members: parts.map((part) => ({
                workId: part.id,
                kind: 'build',
                title: part.title,
                repository: part.repo,
                status: part.status,
                complete: false,
                waits: [],
            })),
        },
    };

    await mountPage(fresh({ ...sample, items: [parent, ...parts] }));
    expect(text($('[data-item="delivery"]'))).toContain('2 builds running · 1 waiting');

    expect(text($('.desk-row[data-item="delivery"] [data-desk-more]'))).toBe('2 builds running · 1 waiting');

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(parent.id));
    // The group's status reads in the summary line, where the header's group status used to sit.
    expect(text($('[data-item-summary]'))).toContain('2 builds running · 1 waiting');
    expect(text($('[data-concept-build-run]'))).not.toContain('Not started');
    await settle(() => useItemDialogStore.getState().open(parts[0]!.id));
    expect(text($('[data-earlier-threads]'))).toContain('Current build owner');
    expect(text($('[data-earlier-threads]'))).not.toContain('Stale shaping owner');
    expect(
        $$('[data-open-thread="build-0"]').every((link) => link.getAttribute('href')?.endsWith('/current-build')),
    ).toBe(true);
});

test('a stale Ready gate explains the hold on its row, desk and details and offers Approve brief', async () => {
    const reason = 'Gate out of date: brief changed since approval';
    const stale: Item = {
        ...base,
        id: 'stale',
        flow: 'single',
        parentId: null,
        parent: null,
        status: 'Ready',
        threads: [],
        linkedPrs: [],
        blockers: [],
        slices: [],
        passingBrief: false,
        staleGate: 'brief',
        briefApproval: { reason },
    };

    await mountPage(fresh({ ...sample, items: [stale] }));
    expect(text($('[data-stale-gate="stale"]'))).toBe(reason);
    expect(text($('.desk-row[data-item="stale"]'))).toContain('Approve brief');

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(stale.id));
    expect(text($('[data-item-summary]'))).toContain(reason);
    expect(text($('[data-item-dialog]'))).toContain('Approve brief');
});
