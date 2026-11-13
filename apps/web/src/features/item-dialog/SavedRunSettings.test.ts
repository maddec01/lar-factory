import type { SavedRunChoices } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { detailsRead, detailsReply, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

test('item details show saved model, effort and reviewer choices read-only', async () => {
    const run: SavedRunChoices = {
        runId: 'saved-run',
        kind: 'build',
        capturedAt: '2026-10-20T10:00:00Z',
        thread: { model: { instanceId: 'codex', model: 'saved-model' }, effort: 'high' },
        roles: [{ role: 'planner', model: null, effort: null }],
        reviewers: [{ id: 'docs', name: 'Documentation', mode: 'never', instructions: 'Custom revision 2' }],
    };

    let wrote = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        wrote ||= init?.method === 'POST';

        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(sample));

        const reply = await detailsReply(id).json();

        reply.details.record = {
            bodyKind: 'brief',
            body: 'Saved brief',
            context: '',
            buildPhase: null,
            reviewRounds: [],
            runSettings: [run],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage();

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open('I_sample13'));

    const section = document.querySelector<HTMLDetailsElement>('[data-saved-run]')!;

    await settle(() => {
        section.open = true;
        section.dispatchEvent(new Event('toggle'));
    });
    expect(text(section)).toContain('codex / saved-model · Effort: high');
    expect(text(section)).toContain('T3 default (not resolved)');
    expect(text(section)).toContain('Custom revision 2 · Never');
    expect(section.querySelector('input, textarea, select')).toBeNull();
    expect(wrote).toBe(false);
});

test('an open dialog updates the build phase from live board data while detail text stays cached', async () => {
    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(sample));

        const reply = await detailsReply(id).json();

        reply.details.record = {
            bodyKind: 'brief',
            body: 'Brief',
            context: '',
            buildPhase: 'review',
            reviewRounds: [],
        };

        return new Response(JSON.stringify(reply));
    });

    const data = {
        ...sample,
        items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, buildPhase: 'review' } : i)),
    };

    await mountPage(data);

    const { useItemDialogStore } = await import('./ItemDialogStore');
    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useItemDialogStore.getState().open('I_sample13'));
    expect(text(document.querySelector('[data-build-phase]'))).toBe('Build phaseReview');
    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((i) => (i.id === 'I_sample13' ? { ...i, buildPhase: 'approve' } : i)),
        }),
    );
    expect(text(document.querySelector('[data-build-phase]'))).toBe('Build phaseAwaiting approval');
});
