import { expect, test } from 'vite-plus/test';
import { decisionType, parseDecisionMethod, type Item } from './model.ts';

test('reads a local decision method from its first line', () => {
  for (const method of ['grill', 'prototype', 'research', 'task']) {
    expect(parseDecisionMethod(`Method: ${method}\n\nChoose an approach.`)).toBe(method);
  }
  expect(parseDecisionMethod(' Method: Prototype\r\nQuestion')).toBe('prototype');
  for (const body of ['', 'Method: something else', 'Question\nMethod: grill']) expect(parseDecisionMethod(body)).toBeNull();
});

test('local methods take precedence over legacy ticket labels, including an unknown method', () => {
  const legacy = { labels: ['decision-research'] } as Item;
  expect(decisionType(legacy)).toBe('research');
  expect(decisionType({ ...legacy, decisionMethod: 'prototype' })).toBe('prototype');
  expect(decisionType({ ...legacy, decisionMethod: null })).toBeNull();
});
