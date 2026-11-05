// The loading screen's line for each step of the first read.

import { expect, test } from 'vite-plus/test';
import type { FirstRead } from '@lar-factory/shared';
import { stepText } from './step-text.ts';

const read = (step: FirstRead['step'], running: string[] = []): FirstRead => ({ step, running, settled: false });

test('each step names what the first read is doing', () => {
  expect(stepText(read('repositories'))).toBe('Loading Projects');
  expect(stepText(read('items'))).toBe('Loading Projects');
  expect(stepText(read('finishing'))).toBe('Finishing up');
});

test('project names do not appear as running reads finish', () => {
  expect(stepText(read('items', ['lar-apple', 'lar-server']))).toBe('Loading Projects');
  expect(stepText(read('items', ['lar-server']))).toBe('Loading Projects');
  expect(stepText(read('items', ['lar-apple', 'lar-server', 'lar-brand']))).toBe('Loading Projects');
});

test('the running reads come before the step when both are there', () => {
  expect(stepText(read('finishing', ['lar-apple']))).toBe('Loading Projects');
});
