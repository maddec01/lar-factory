import { expect, test } from 'vite-plus/test';
import { effectiveVocabulary, resolveVocabulary } from './vocabulary.ts';

test('conflicting requests stay unresolved until the user chooses a type or none, while labels combine once', () => {
  const { vocabulary } = effectiveVocabulary({ build: { type: 'Task', labels: ['delivery'] }, bug: { type: 'Bug', labels: ['delivery', 'defect'] } });
  expect(resolveVocabulary(vocabulary, 'build', 'bug')).toEqual({ ready: false,
    vocabulary: { build: { type: 'Task', labels: ['delivery'] }, bug: { type: 'Bug', labels: ['delivery', 'defect'] } },
    labels: ['delivery', 'defect'], candidates: ['Task', 'Bug'], requests: [{ key: 'build', type: 'Task' }, { key: 'bug', type: 'Bug' }] });
  const resolved = resolveVocabulary(vocabulary, 'build', 'bug', null);
  expect(resolved.ready && resolved.typeResolution).toEqual({ candidates: ['Task', 'Bug'], selected: null });
  const bug = resolveVocabulary(vocabulary, 'build', 'bug', 'Bug');
  expect(bug.ready && bug.typeResolution.selected).toBe('Bug');
  expect(() => resolveVocabulary(vocabulary, 'build', 'bug', 'Epic')).toThrow(/requested/);
});

test('compatible types resolve once, and concept scope and concept kind remain distinct requests', () => {
  const { vocabulary } = effectiveVocabulary({ concept: { type: 'Epic', labels: ['planning'] }, 'concept-kind': { type: 'Epic', labels: ['planning'] } });
  const result = resolveVocabulary(vocabulary, 'concept', 'concept');
  expect(result.ready && result.typeResolution).toEqual({ candidates: ['Epic'], selected: 'Epic' });
  expect(result.labels).toEqual(['planning']);
});


test('same-name label suggestions preserve provider spelling without applying mappings', async () => {
  const { suggestVocabularyLabels } = await import('./vocabulary.ts');
  expect(suggestVocabularyLabels({ state: 'available', choices: ['Bug', 'feature', 'improvement', 'bugfix', 'build'] })).toEqual({
    bug: { type: null, labels: ['Bug'] }, feature: { type: null, labels: ['feature'] }, improvement: { type: null, labels: ['improvement'] },
  });
  expect(suggestVocabularyLabels({ state: 'refused', reason: 'denied' })).toEqual({});
  expect(suggestVocabularyLabels({ state: 'unsupported', reason: 'unsupported' })).toEqual({});
  expect(suggestVocabularyLabels({ state: 'available', choices: [] })).toEqual({});
  expect(effectiveVocabulary().vocabulary.bug).toEqual({ type: null, labels: [] });
});
