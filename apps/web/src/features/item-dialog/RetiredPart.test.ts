import { expect, test } from 'vite-plus/test';

import { $, detailsRead, fetchMock, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

test('a retired part opens its historical brief without publication, approval or start actions', async () => {
    const child = {
        ...sample.items.find((item) => item.id === 'I_sample13')!,
        setAside: true,
        passingBrief: false,
        number: 0,
        threads: [],
        stats: undefined,
    };
    const parent = { ...sample.items.find((item) => item.id === 'I_sample09')!, retiredParts: [child] };
    const board = fresh({ ...sample, items: [parent] });

    fetchMock.mockImplementation(
        async (url: string) =>
            new Response(
                JSON.stringify(
                    detailsRead(url) === child.id
                        ? {
                              details: {
                                  body: '',
                                  format: 'markdown',
                                  author: null,
                                  assignees: [],
                                  createdAt: null,
                                  subTickets: [],
                                  comments: [],
                                  hasOlderComments: false,
                                  olderCursor: null,
                                  record: {
                                      bodyKind: 'brief',
                                      body: 'Historical acceptance',
                                      context: '',
                                      buildPhase: null,
                                      reviewRounds: [],
                                  },
                              },
                          }
                        : board,
                ),
            ),
    );
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(child.id));

    const dialog = $('[data-item-dialog]')!;

    expect(text(dialog)).toContain('Historical acceptance');
    expect(text(dialog)).toContain('Set aside');
    expect(text(dialog)).not.toMatch(/Attach a ticket|Create issue|Approve brief|Start build|Stage 3 of/);
});
