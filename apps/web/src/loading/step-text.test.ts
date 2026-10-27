// The loading screen's line for each step of the first read.

import { expect, test } from 'vite-plus/test';
import type { FirstRead } from '@lar-factory/shared';
import { stepText } from './step-text.ts';

const read = (step: FirstRead['step'], running: string[] = []): FirstRead => ({ step, running, settled: false });

test('each step names what the first read is doing', () => {
  expect(stepText(read('repositories'))).toBe('Checking repositories');
  expect(stepText(read('items'))).toBe('Reading items');
  expect(stepText(read('finishing'))).toBe('Finishing up');
});

test('reads still running are named, and each drops off as it finishes', () => {
  expect(stepText(read('items', ['lar-apple', 'lar-server']))).toBe('Reading lar-apple and lar-server');
  expect(stepText(read('items', ['lar-server']))).toBe('Reading lar-server');
  expect(stepText(read('items', ['lar-apple', 'lar-server', 'lar-brand']))).toBe('Reading lar-apple, lar-server and lar-brand');
});

test('the running reads come before the step when both are there', () => {
  expect(stepText(read('repositories', ['lar-apple']))).toBe('Reading lar-apple');
});
