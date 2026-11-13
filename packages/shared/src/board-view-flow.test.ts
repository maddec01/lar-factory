import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { isDossierParent, placementOf } from './board-view.ts';
import { STATUSES } from './model.ts';
import type { Item, StartProgress, StartPurpose } from './model.ts';

const work = (change: Partial<Item>): Item => ({
    ...(sample.items[0] as Item),
    id: 'work',
    kind: 'build',
    flow: 'single',
    parent: null,
    parentId: null,
    threads: [],
    linkedPrs: [],
    ...change,
});
const starts: Partial<Record<StartPurpose, StartProgress>>[] = [
    {},
    { shape: { phase: 'starting' } },
    { shape: { phase: 'may-have-started', message: 'Unknown' } },
    { build: { phase: 'starting' } },
    { build: { phase: 'may-have-started', message: 'Unknown' } },
    { build: { phase: 'failed', message: 'Failed' } },
];

for (const kind of ['concept', 'issue'] as const) {
    test(`${kind} parents and parts never enter single-flow stages, whatever their status or launch intent`, () => {
        for (const status of STATUSES) {
            const parent = work({ id: 'parent', kind, flow: 'linked', status });
            const part = work({ flow: 'linked', parentId: parent.id, status });

            for (const intent of starts) {
                for (const item of [parent, part]) {
                    const sections = placementOf(item, {
                        starts: intent,
                        all: [parent, part],
                        unavailable: false,
                    }).sections;

                    expect(
                        sections.filter((section) => !['desk', 'dock'].includes(section)),
                        `${kind} ${status}`,
                    ).toEqual([]);

                    if (status !== 'Done') expect(sections).toContain('dock');

                    if (['Needs you', 'Verify', 'Ready to merge'].includes(status)) expect(sections).toContain('desk');
                }
            }
        }
    });
}

test('a queued concept with no children heads a dossier, even before any flow projection', () => {
    const concept = work({ kind: 'concept', status: 'Queued' });

    expect(placementOf(concept, { all: [concept], unavailable: false }).sections).toEqual(['dock']);
    expect(isDossierParent(concept, [concept])).toBe(true);
});

test('a single build keeps its stage and slice question even with private children', () => {
    const build = work({ status: 'In progress', slices: [{ workId: 'slice', progress: 'active' }] as Item['slices'] });
    const privateChild = work({ id: 'slice', parentId: build.id });

    expect(placementOf(build, { all: [build, privateChild], unavailable: false }).sections).toEqual(['build']);
    expect(isDossierParent(build, [build, privateChild])).toBe(false);
    build.status = 'Needs you';
    build.threads = [{ id: 'build', purpose: 'build', state: 'needs you' }] as Item['threads'];
    expect(placementOf(build, { all: [build], unavailable: false }).sections).toEqual(['desk', 'build']);
});
