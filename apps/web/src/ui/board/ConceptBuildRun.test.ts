import type { ConceptBuildPlan } from '@lar-factory/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';

import { ConceptBuildRun } from './ConceptBuildRun';

const holdPlan = (run: ConceptBuildPlan['run'] = null): ConceptBuildPlan => ({
    run,
    members: [{ workId: 'decision', kind: 'decision' } as ConceptBuildPlan['members'][number]],
    holds: [
        { workId: 'decision', reason: "Its confirmed answer isn't recorded. Its domain drafts aren't recorded." },
        { workId: 'build', reason: 'The current brief needs an approved gate.' },
        { workId: 'decision', reason: "Its Fog isn't gone." },
        { workId: 'decision', reason: 'Its map is empty.' },
    ],
});
const renderCompact = (plan: ConceptBuildPlan) => {
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

    return root;
};

test('a compact row action renders only when it can act: a held run shows nothing, not a disabled button', () => {
    const held = renderCompact(holdPlan());

    expect(held.innerHTML).toBe('');
    expect(held.querySelector('button')).toBeNull();
    expect(held.querySelector('details')).toBeNull();

    const ready = renderCompact({ run: null, members: [], holds: [] });
    const start = ready.querySelector('button')!;

    expect(start.textContent).toBe('Build all');
    expect(start.title).toBe('Start concept builds');
    expect(start.disabled).toBe(false);

    const running = renderCompact({
        ...holdPlan({ state: 'running', startedAt: '2026-11-14', prepared: {} }),
        holds: [],
    });

    expect(running.querySelector('button')?.textContent).toBe('Pause');
    expect(running.querySelector('button')?.title).toBe('Pause concept builds');
});

test('an expanded concept says its builds in one line, folding the hold reasons under it while held', () => {
    const render = (plan: ConceptBuildPlan) => {
        const root = document.createElement('div');

        root.innerHTML = renderToStaticMarkup(
            createElement(ConceptBuildRun, {
                holdsSummarized: true,
                plan,
                pending: false,
                error: null,
                onChange: () => {},
                startLabel: 'Start concept builds',
                capacity: null,
                progress: { building: 0, waiting: 3, complete: 15, total: 18, names: '', outside: 0 },
            }),
        );

        return root;
    };
    const plan = holdPlan();

    plan.holds = [
        { workId: 'a', reason: 'Decision A is not settled.' },
        { workId: 'b', reason: 'Decision B is not settled.' },
        { workId: 'c', reason: 'The current brief needs an approved gate.' },
    ];
    plan.members = [
        { workId: 'a', kind: 'decision' },
        { workId: 'b', kind: 'decision' },
        { workId: 'c', kind: 'build' },
    ] as ConceptBuildPlan['members'];

    const held = render(plan);
    const disclosure = held.querySelector('details')!;

    expect(disclosure.querySelector('summary')?.textContent).toMatch(
        /^15\/18 builds done · waiting on 2 open decisions and 1 /,
    );
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain('Decision A is not settled.');
    expect(held.textContent).not.toContain('Concept builds');
    expect(held.textContent).not.toContain('Build hold details');

    const calm = render({ run: null, members: [], holds: [] });

    expect(calm.querySelector('details')).toBeNull();
    expect(calm.querySelector('[data-concept-build-progress]')?.textContent).toBe('15/18 builds done');
});

test('a completed scheduling run never presents Pause or Start again', () => {
    const markup = renderToStaticMarkup(
        createElement(ConceptBuildRun, {
            plan: { run: { state: 'completed', startedAt: '2026-11-14', prepared: {} }, members: [], holds: [] },
            pending: false,
            error: null,
            onChange: () => {},
            startLabel: 'Start concept builds',
            capacity: null,
        }),
    );

    expect(markup).toContain('All planned builds complete.');
    expect(markup).not.toContain('Paused');
    expect(markup).not.toContain('<button');
});
