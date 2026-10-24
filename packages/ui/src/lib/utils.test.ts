import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cn } from './utils.ts';

test('cn keeps a theme font size next to a text colour', () => {
  assert.equal(cn('text-2xs', 'text-muted-foreground'), 'text-2xs text-muted-foreground');
});

test('cn lets a later class win over a conflicting one', () => {
  assert.equal(cn('h-7 px-2', { 'h-6': true }), 'px-2 h-6');
});
