import { expect, test } from 'vite-plus/test';

import { effectiveVocabulary, resolveVocabulary } from './vocabulary.ts';

test('conflicting requests stay unresolved until the user chooses a type or none, while labels combine once', () => {
    const { vocabulary } = effectiveVocabulary({
        build: { type: 'Task', labels: ['delivery'] },
        bug: { type: 'Bug', labels: ['delivery', 'defect'] },
    });

    expect(resolveVocabulary(vocabulary, 'build', 'bug')).toEqual({
        ready: false,
        vocabulary: {
            build: { type: 'Task', labels: ['delivery'] },
            bug: { type: 'Bug', labels: ['delivery', 'defect'] },
        },
        labels: ['delivery', 'defect'],
        candidates: ['Task', 'Bug'],
        requests: [
            { key: 'build', type: 'Task' },
            { key: 'bug', type: 'Bug' },
        ],
    });

    const resolved = resolveVocabulary(vocabulary, 'build', 'bug', null);

    expect(resolved.ready && resolved.typeResolution).toEqual({ candidates: ['Task', 'Bug'], selected: null });

    const bug = resolveVocabulary(vocabulary, 'build', 'bug', 'Bug');

    expect(bug.ready && bug.typeResolution.selected).toBe('Bug');
    expect(() => resolveVocabulary(vocabulary, 'build', 'bug', 'Epic')).toThrow(/requested/);
});
