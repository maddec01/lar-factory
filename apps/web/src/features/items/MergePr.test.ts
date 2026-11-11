import { expect, test } from 'vite-plus/test';

import { $, $$, answer, holdPosts, mountPage, posted, sample, settle, text } from '@/test/PageTest';

const confirmation = {
    token: 'confirm8',
    number: 8,
    url: 'https://github.com/o/r/pull/8',
    sourceRevision: 'abc123',
    methods: ['merge', 'squash'],
};
const data = () => ({
    ...sample,
    items: sample.items.map((i) =>
        i.id === 'I_sample16'
            ? {
                  ...i,
                  status: 'Ready to merge' as const,
                  threads: [],
                  linkedPrs: [
                      {
                          ...i.linkedPrs[0]!,
                          number: 8,
                          url: confirmation.url,
                          sourceRevision: 'abc123',
                          checks: null,
                          state: 'open' as const,
                          isDraft: false,
                          mergeState: 'can merge' as const,
                      },
                  ],
              }
            : i,
    ),
});
const confirmButton = () => $$<HTMLButtonElement>('#merge-pr-dialog button').find((b) => text(b) === 'Merge PR')!;
const press = async (label: string) =>
    settle(() =>
        $$<HTMLButtonElement>('button')
            .find((b) => text(b) === label)!
            .click(),
    );

test('Merge PR always confirms the exact revision, permits method choice and cancels without a merge write', async () => {
    holdPosts();
    await mountPage(data());
    await press('Merge PR');
    expect(posted().map((p) => p[0])).toEqual(['/api/inspect-merge']);
    await answer({ error: null, confirmation });
    expect(text($('#merge-pr-dialog'))).toContain('abc123');
    expect($('#merge-pr-dialog a')?.getAttribute('href')).toBe(confirmation.url);
    expect($$('[role="radio"]')).toHaveLength(2);
    await press('Cancel');
    expect($('#merge-pr-dialog')).toBeNull();
    expect(posted()).toHaveLength(1);
    await press('Merge PR');
    await answer({ error: null, confirmation });
    await settle(() => $<HTMLButtonElement>('[role="radio"][value="squash"]')!.click());
    await settle(() => confirmButton().click());
    expect(posted().at(-1)).toMatchObject([
        '/api/merge-pr',
        { itemId: 'I_sample16', token: 'confirm8', method: 'squash' },
    ]);
    await answer({ error: 'Provider refused merge.' }, 409);
    expect(text($('#merge-pr-dialog'))).toContain('Provider refused merge.');
    expect($('#merge-pr-dialog a')?.textContent).toBe('Open PR');
});

test('failed readiness explains the blocker and leaves Open PR available without a mutation', async () => {
    holdPosts();
    await mountPage(data());
    await press('Merge PR');
    await answer({ error: 'Merge queue required. Open PR to continue at GitHub.' }, 409);
    expect(text($('#merge-pr-dialog'))).toContain('Merge queue required.');
    expect(confirmButton().disabled).toBe(true);
    expect($('#merge-pr-dialog a')?.textContent).toBe('Open PR');
    await press('Cancel');
    expect(posted().some(([url]) => url === '/api/merge-pr')).toBe(false);
});

test('an uncertain response requires a provider readiness read and another confirmation before retrying', async () => {
    holdPosts();
    await mountPage(data());
    await press('Merge PR');
    await answer({ error: null, confirmation });
    await settle(() => confirmButton().click());
    expect($<HTMLButtonElement>('#merge-pr-dialog button:first-child')!.disabled).toBe(true);
    await answer({ error: 'Merge outcome unknown. Refresh readiness.' }, 409);
    expect(confirmButton().disabled).toBe(true);
    await press('Refresh readiness');
    expect(posted().at(-1)![0]).toBe('/api/inspect-merge');
    await answer({
        error: null,
        merged: true,
        board: { ...data(), items: data().items.map((i) => (i.id === 'I_sample16' ? { ...i, status: 'Done' } : i)) },
    });
    expect($('#merge-pr-dialog')).toBeNull();
    expect(posted().filter(([url]) => url === '/api/merge-pr')).toHaveLength(1);
});

test('pending confirmation disables merge actions on the desk and in the item dialog', async () => {
    holdPosts();
    await mountPage(data());

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open('I_sample16'));
    expect($$<HTMLButtonElement>('button').filter((b) => text(b) === 'Merge PR')).toHaveLength(2);
    await press('Merge PR');
    await answer({ error: null, confirmation });
    await settle(() => confirmButton().click());
    expect(
        $$<HTMLButtonElement>('button')
            .filter((b) => text(b) === 'Merge PR')
            .every((b) => b.disabled || b.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
    await answer({ error: null, merged: true });
    expect(posted().filter(([url]) => url === '/api/merge-pr')).toHaveLength(1);
});
