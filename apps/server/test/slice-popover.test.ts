import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_POPOVER, nextPopover, openPopover } from '../src/slice-popover.ts';
import type { PopoverEvent } from '../src/slice-popover.ts';

const after = (...events: PopoverEvent[]) => openPopover(events.reduce(nextPopover, NO_POPOVER));

test('a slice popover opens on hover, focus or tap, and closes when they end', () => {
  assert.equal(after({ type: 'hover', id: 'A' }), 'A');
  assert.equal(after({ type: 'hover', id: 'A' }, { type: 'hover', id: null }), null);
  assert.equal(after({ type: 'focus', id: 'A' }), 'A');
  assert.equal(after({ type: 'focus', id: 'A' }, { type: 'focus', id: null }), null);
  assert.equal(after({ type: 'tap', id: 'A' }), 'A');
  assert.equal(after({ type: 'tap', id: 'A' }, { type: 'outside' }), null);
});

test('a second click or tap on the trigger closes it, while the pointer and focus stay', () => {
  const tap: PopoverEvent = { type: 'tap', id: 'A' };
  const touch: PopoverEvent[] = [{ type: 'focus', id: 'A' }, tap];
  assert.equal(after(...touch, tap), null, 'a tap');
  assert.equal(after(...touch, tap, tap), 'A', 'a third tap opens it again');
  const mouse: PopoverEvent[] = [{ type: 'hover', id: 'A' }, { type: 'focus', id: 'A' }, tap];
  assert.equal(after(...mouse), 'A', 'the first click keeps the hovered popover open');
  assert.equal(after(...mouse, tap), null, 'a click');
  assert.equal(after(...mouse, tap, { type: 'focus', id: null }, { type: 'hover', id: null }, { type: 'hover', id: 'A' }), 'A',
    'it opens on hover again once the pointer and focus have left');
});

test('the hovered popover wins over the focused one', () => {
  assert.equal(after({ type: 'focus', id: 'A' }, { type: 'hover', id: 'B' }), 'B');
  assert.equal(after({ type: 'focus', id: 'A' }, { type: 'hover', id: 'B' }, { type: 'hover', id: null }), 'A');
});

test('Escape closes it while focus stays on its trigger, and it opens again once focus leaves and returns', () => {
  const focused: PopoverEvent = { type: 'focus', id: 'A' };
  assert.equal(after(focused, { type: 'escape' }), null);
  assert.equal(after(focused, { type: 'escape' }, { type: 'hover', id: 'A' }), null, 'still closed under the pointer');
  assert.equal(after(focused, { type: 'escape' }, { type: 'focus', id: null }, focused), 'A');
});

test('Enter or Space on the trigger toggles it', () => {
  const focused: PopoverEvent = { type: 'focus', id: 'A' };
  assert.equal(after(focused, { type: 'toggle', id: 'A' }), null);
  assert.equal(after(focused, { type: 'toggle', id: 'A' }, { type: 'toggle', id: 'A' }), 'A');
});
