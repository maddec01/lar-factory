import { expect, test } from 'vite-plus/test';

import { decisionMethodName, decisionType, parseDecisionMethod, type Item } from './model.ts';

test('reads a local decision method from its first line', () => {
    for (const method of ['grill', 'prototype', 'research', 'task']) {
        expect(parseDecisionMethod(`Method: ${method}\n\nChoose an approach.`)).toBe(method);
    }
    expect(parseDecisionMethod(' Method: Prototype\r\nQuestion')).toBe('prototype');
    for (const body of ['', 'Method: something else', 'Question\nMethod: grill'])
        expect(parseDecisionMethod(body)).toBeNull();
});

test('local methods take precedence over legacy ticket labels, including an unknown method', () => {
    const legacy = { labels: ['decision-research'] } as Item;
    expect(decisionType(legacy)).toBe('research');
    expect(decisionType({ ...legacy, decisionMethod: 'prototype' })).toBe('prototype');
    expect(decisionType({ ...legacy, decisionMethod: null })).toBeNull();
});

test('a decision names its method, or No method, and other kinds of work have none', () => {
    const decision = { kind: 'decision', labels: [] } as unknown as Item;
    expect(decisionMethodName({ ...decision, decisionMethod: 'research' })).toBe('Research');
    expect(decisionMethodName({ ...decision, decisionMethod: null })).toBe('No method');
    expect(decisionMethodName({ ...decision, labels: ['decision-other'] })).toBe('No method');
    expect(decisionMethodName({ ...decision, kind: 'build' })).toBeNull();
});
