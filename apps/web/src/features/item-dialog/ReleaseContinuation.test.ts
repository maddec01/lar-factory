import { expect, test } from 'vite-plus/test';

import { fresh, mountPage, sample, settle, posted } from '@/test/PageTest';

test.each(['concept', 'build'] as const)(
    'delivered %s parent resumes release without starting another shaping owner',
    async (kind) => {
        const id = 'release-parent';
        const board = fresh({
            ...sample,
            capture: { enabled: true, session: 'sample' },
            items: [
                {
                    ...sample.items[0]!,
                    id,
                    number: 0,
                    kindDisagreement: undefined,
                    kind,
                    flow: 'linked',
                    parentId: null,
                    parent: null,
                    status: 'Shaping',
                    linkedPrs: [],
                    revision: 12,
                    threads: [
                        {
                            id: 'release-owner',
                            title: 'Release',
                            state: kind === 'build' ? 'needs you' : 'done',
                            updated: '2026-11-14T12:00:00Z',
                            purpose: 'shape',
                            ...(kind === 'build'
                                ? {
                                      questionSummary: 'Approve activating the approved manifest?',
                                      pendingRequest: {
                                          id: 'legacy-approval',
                                          threadId: 'release-owner',
                                          kind: 'question' as const,
                                      },
                                  }
                                : {}),
                        },
                    ],
                    releasePlan: {
                        steps: [
                            {
                                id: 'approve',
                                who: 'Pedro',
                                what: 'Approve activation of exact manifest',
                                done: {
                                    by: 'Pedro',
                                    at: '2026-11-14T11:00:00Z',
                                    evidence: 'Approved exact manifest abc.',
                                },
                            },
                            { id: 'activate', who: 'Agent', what: 'Activate approved manifest', done: null },
                        ],
                        outcomeCheck: { what: 'Check composition', result: 'pending', evidence: null },
                    },
                },
                { ...sample.items[0]!, id: 'delivered-part', parentId: id, kind: 'build', status: 'Done', threads: [] },
            ],
        });

        await mountPage(board);

        const { useItemDialogStore } = await import('./ItemDialogStore');

        await settle(() => useItemDialogStore.getState().open(id));

        const dialog = document.querySelector('[data-item-dialog]')!;
        const buttons = [...dialog.querySelectorAll('button')];
        const resume = buttons.find((button) => button.textContent === 'Resume release');

        expect(resume).toBeTruthy();
        expect(dialog.textContent).not.toContain('Resume shaping');
        expect(dialog.textContent).not.toContain('Answer in T3');

        if (kind === 'build') expect(dialog.textContent).toContain('superseded by the board release step');

        resume!.click();
        await settle();
        expect(posted().at(-1)).toEqual(['/api/resume-release', { itemId: id, revision: 12 }]);
        expect(posted().some(([url]) => url === '/api/start')).toBe(false);
    },
);
