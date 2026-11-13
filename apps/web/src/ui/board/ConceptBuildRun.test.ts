import type { ConceptBuildPlan } from '@lar-factory/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';

import { ConceptBuildRun } from './ConceptBuildRun';

test('a compact blocked action shows a short summary with expandable full reasons', () => {
    const plan: ConceptBuildPlan = {
        run: null,
        members: [{ workId: 'decision', kind: 'decision' } as ConceptBuildPlan['members'][number]],
        holds: [
            { workId: 'decision', reason: "Its confirmed answer isn't recorded. Its domain drafts aren't recorded." },
            { workId: 'build', reason: 'The current brief needs an approved gate.' },
        ],
    };
    const root = document.createElement('div');

    root.innerHTML = renderToStaticMarkup(
        createElement(ConceptBuildRun, {
            compact: true,
            plan,
            pending: false,
            error: null,
            onChange: () => {},
            startLabel: 'Start concept builds',
            capacity: '0 of 2 building',
        }),
    );
    expect(root.querySelector('button')?.disabled).toBe(true);
    expect(root.textContent).toContain('Waiting on 1 decision and 1 gate');
    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('details')?.textContent).toContain("Its domain drafts aren't recorded.");
});

test('the expanded panel has one progress status and only shows capacity when it holds a part', () => {
    const render = (capacity: string | null) => {
        const root = document.createElement('div');

        root.innerHTML = renderToStaticMarkup(
            createElement(ConceptBuildRun, {
                plan: { run: null, members: [], holds: [] },
                pending: false,
                error: null,
                onChange: () => {},
                startLabel: 'Start concept builds',
                capacity,
                progress: { building: 2, waiting: 1, complete: 0, total: 3, names: 'A, B', outside: 0 },
            }),
        );

        return root;
    };
    const root = render(null);

    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(root.querySelector('[data-concept-build-progress]')?.textContent).toBe(
        '2 building · 1 waiting · 0/3 complete',
    );
    expect(root.querySelector('[data-shared-build-capacity]')).toBeNull();
    expect(root.textContent).not.toContain('Not started');
    expect(root.textContent).not.toContain('2 builds running');

    const full = render('Shared capacity full: 2 of 2 slots in use');

    expect(full.querySelectorAll('[data-shared-build-capacity]')).toHaveLength(1);
});
