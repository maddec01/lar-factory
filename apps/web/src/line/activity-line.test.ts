// What the line's clock costs the row around it: a second moves the age and renders no status glyph. The glyphs are
// counted through their module, mocked here rather than hoisted, so they keep the store of the page support.ts mounts.

import { expect, test, vi } from 'vite-plus/test';
import type { ReactNode } from 'react';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { $, NOW, mountPage, sample, settle, text } from '../../test/support.ts';

let glyphRenders = 0;

const at = new Date(NOW).toISOString();
const thread: ItemThread = { id: 't', title: 'Build', state: 'running', updated: at, activity: { available: true, action: 'Read a.ts', actionAt: at, toolRunning: false, agents: [] } };
const item = { ...sample.items[0], id: 'I_build', number: null, parent: null, parentId: null, status: 'In progress', blockers: [], slices: [], threads: [thread] } as unknown as Item;

test('a second moves the age and renders nothing around the line', async () => {
  vi.doMock('../items/status-glyph.tsx', async (original) => {
    const real = await original<typeof import('../items/status-glyph.tsx')>();
    return { ...real, StatusGlyph: (props: Parameters<typeof real.StatusGlyph>[0]): ReactNode => { glyphRenders += 1; return real.StatusGlyph(props); } };
  });
  await mountPage({ ...sample, items: [item], error: null, fetchedAt: at, firstRead: { ...sample.firstRead, settled: true } } as BoardData);
  expect(text($('[data-age]'))).toBe('· 0s');
  glyphRenders = 0;
  await settle(() => vi.advanceTimersByTime(3_000));
  expect(text($('[data-age]'))).toBe('· 3s');
  expect(glyphRenders).toBe(0);
});
