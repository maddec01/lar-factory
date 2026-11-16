import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { isManagedLabel, kindLabelSwap } from './managed-labels.ts';
import { effectiveVocabulary } from './vocabulary.ts';

const KIND_NAMES = [
    'concept',
    'decision',
    'decision-grill',
    'bug',
    'defect',
    'feature',
    'enhancement',
    'user story',
    'product backlog item',
    'improvement',
    'build',
];
const STATUS_NAMES = ['status-queued', 'status-needs-you'];

test('every name trackerKind reads, linked-work and status-* are managed, in any case', () => {
    for (const name of [...KIND_NAMES, ...STATUS_NAMES, 'linked-work']) {
        assert.equal(isManagedLabel(name), true, name);
        assert.equal(isManagedLabel(name.toUpperCase()), true, name.toUpperCase());
    }
    for (const name of ['area: web', 'bugs', 'decisions', 'priority: high', 'status'])
        assert.equal(isManagedLabel(name), false, name);
});

const swapVocabulary = effectiveVocabulary({
    bug: { type: 'Bug', labels: ['type: bug'] },
    feature: { type: null, labels: ['type: feature', 'feature'] },
    improvement: { type: null, labels: [] },
    build: { type: null, labels: ['shipping'] },
}).vocabulary;

test('a kind swap removes the mapped labels of the other kinds and every kind name, and adds the new kind’s own', () => {
    assert.deepEqual(
        kindLabelSwap(
            [
                'Type: Bug',
                'Defect',
                'bug',
                'ENHANCEMENT',
                'User Story',
                'product backlog item',
                'improvement',
                'needs-design',
            ],
            'feature',
            swapVocabulary,
        ),
        {
            add: ['type: feature', 'feature'],
            remove: ['Type: Bug', 'Defect', 'bug', 'improvement'],
        },
    );
});

test('a kind swap keeps build, concept and decision labels, and a label the new kind maps', () => {
    assert.deepEqual(
        kindLabelSwap(
            ['build', 'concept', 'decision', 'decision-grill', 'shipping', 'linked-work', 'Feature'],
            'feature',
            swapVocabulary,
        ),
        {
            add: ['type: feature'],
            remove: [],
        },
    );
});
