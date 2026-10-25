// The sidebar's width rules: the board's 300 px default, T3's 208 px minimum or the brand row, and the 640 px the
// main area keeps.

import { expect, test } from 'vite-plus/test';
import {
  clampThreadSidebarWidth,
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  resolveThreadSidebarMinimumWidth,
} from './threadSidebarWidth.ts';

test('the minimum is 208 px, or the brand row rounded up when it is wider', () => {
  expect(resolveThreadSidebarMinimumWidth(0)).toBe(208);
  expect(resolveThreadSidebarMinimumWidth(250.2)).toBe(251);
});

test('the maximum leaves the main area 640 px, but never drops below the minimum', () => {
  expect(resolveThreadSidebarMaximumWidth(1440.7)).toBe(800);
  expect(resolveThreadSidebarMaximumWidth(700, 260)).toBe(260);
});

test('a width clamps between the minimum and the maximum', () => {
  expect([100, 300, 900].map((width) => clampThreadSidebarWidth(width, 208, 800))).toEqual([208, 300, 800]);
});

test('a new install opens at 300 px; a stored width comes back, at least 208 px and no wider than the window allows', () => {
  expect(resolveInitialThreadSidebarWidth(null, 1440)).toBe(300);
  expect(resolveInitialThreadSidebarWidth(420, 1440)).toBe(420);
  expect(resolveInitialThreadSidebarWidth(120, 1440)).toBe(208);
  expect(resolveInitialThreadSidebarWidth(null, 900)).toBe(260);
});
