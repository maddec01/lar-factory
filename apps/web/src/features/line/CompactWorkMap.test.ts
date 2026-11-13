import { expect, test, vi } from 'vite-plus/test';

import { $, mountPage, sample, settle, text } from '@/test/PageTest';

vi.mock('./useWidth', () => ({ useWidth: () => ({ ref: () => {}, width: 318 }) }));

test('phone map puts every current card in view and names its prerequisites', async () => {
    await mountPage({
        ...sample,
        items: sample.items.map((item) =>
            item.number === 202
                ? {
                      ...item,
                      blockers: [
                          ...item.blockers,
                          {
                              workId: 'external-hosting',
                              number: 0,
                              repo: item.repo,
                              state: 'closed',
                              title: 'Cost of account and discovery hosting',
                          },
                      ],
                  }
                : item,
        ),
    });

    const group = $('[data-dossier="I_sample09"]')!;

    await settle(() => group.querySelector<HTMLButtonElement>('[data-dossier-open]')!.click());

    const stack = group.querySelector('[data-map-stack]')!;
    const cards = [...stack.querySelectorAll<HTMLElement>('[data-map-part]')];

    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.style.width === '294px')).toBe(true);
    expect(text(stack)).toContain('After:');
    expect(text(stack)).toContain('Sign-in screen');
    expect(text(stack)).toContain('Cost of account and discovery hosting');
    expect(stack.querySelector('[data-map-check]')).not.toBeNull();
    await settle(() => cards[0]!.querySelector<HTMLButtonElement>('button')!.click());
    expect($('[data-item-dialog]')).not.toBeNull();
});
