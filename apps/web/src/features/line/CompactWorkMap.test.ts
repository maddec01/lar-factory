import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { $, mountPage, sample, settle, text } from '@/test/PageTest';

vi.mock('./useWidth', () => ({ useWidth: () => ({ ref: () => {}, width: 318 }) }));

// A dossier opens on its parts list; these tests read #200's Work map.
beforeEach(() => localStorage.setItem('lar-board:dossier-view:I_sample09', 'map'));

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

test.each([
    ['pending', 'Waiting for proof'],
    ['insufficient', 'Proof insufficient · waiting'],
    ['submitted', 'Waiting for acceptance as met'],
] as const)('dependency map names %s evidence honestly', async (proofState, expected) => {
    await mountPage({
        ...sample,
        items: sample.items.map((item) =>
            item.number === 202
                ? {
                      ...item,
                      blockers: [
                          {
                              number: 25,
                              repo: 'fake/c',
                              state: 'open',
                              dependency: {
                                  dependencyId: 'proof',
                                  revision: 4,
                                  owner: 'External team',
                                  need: 'v1 proof',
                                  ticket: 'fake/c#25',
                                  named: [],
                                  evidence: 'Closed ticket observation.',
                                  proofState,
                                  met: null,
                                  needsReview: false,
                                  observation: {
                                      subject: 'fake/c#25',
                                      kind: 'closed',
                                      detail: null,
                                      observedAt: 'now',
                                      lastGood: null,
                                  },
                              },
                          },
                      ],
                  }
                : item,
        ),
    });

    const group = $('[data-dossier="I_sample09"]')!;

    await settle(() => group.querySelector<HTMLButtonElement>('[data-dossier-open]')!.click());
    expect(text(group.querySelector('[data-map-prerequisite]'))).toContain(expected);
});
