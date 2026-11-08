// The loading screen's line for each step of the first read.

import type { FirstRead } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { stepText } from './StepText';

const read = (step: FirstRead['step'], running: string[] = []): FirstRead => ({ step, running, settled: false });

test('project names don’t appear as running reads finish', () => {
    expect(stepText(read('items', ['lar-apple', 'lar-server']))).toBe('Loading projects…');
    expect(stepText(read('items', ['lar-server']))).toBe('Loading projects…');
    expect(stepText(read('items', ['lar-apple', 'lar-server', 'lar-brand']))).toBe('Loading projects…');
});

test('the running reads come before the step when both are there', () => {
    expect(stepText(read('finishing', ['lar-apple']))).toBe('Loading projects…');
});
