import { expect, test } from 'vite-plus/test';

import { parseDecisionMethod } from './model.ts';

test('reads a local decision method from its first line', () => {
    for (const method of ['grill', 'prototype', 'research', 'task']) {
        expect(parseDecisionMethod(`Method: ${method}\n\nChoose an approach.`)).toBe(method);
    }
    expect(parseDecisionMethod(' Method: Prototype\r\nQuestion')).toBe('prototype');
    for (const body of ['', 'Method: something else', 'Question\nMethod: grill'])
        expect(parseDecisionMethod(body)).toBeNull();
});
