import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { placementOf } from './board-view.ts';
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

test('concept and issue parents and parts never enter single-flow stages, whatever their status or launch intent', () => {
    for (const kind of ['concept', 'issue'] as const) {
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

                    if (status !== 'Done' && status !== 'List') expect(sections).toContain('dock');

                    if (['Needs you', 'Verify', 'Ready to merge'].includes(status)) expect(sections).toContain('desk');
                }
            }
        }
    }
});
