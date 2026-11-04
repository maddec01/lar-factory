import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';
import { STATUSES } from '@lar-factory/shared';
import { StatusGlyph } from './status-glyph.tsx';

test('status icons stay still without running activity, and Ready has its own arrow', () => {
  for (const status of STATUSES) {
    const html = renderToStaticMarkup(createElement(StatusGlyph, { status }));
    expect(html).not.toMatch(/status-pulse|status-spin/);
    if (status === 'In progress') expect(html).toContain('lucide-circle');
    if (status === 'Ready') expect(html).toContain('lucide-circle-arrow-right');
  }
});

test.each([
  ['In progress', 'lucide-loader-circle', 'status-spin'],
  ['Shaping', 'lucide-circle-dashed', 'status-pulse'],
  ['Review', 'lucide-eye', 'status-pulse'],
  ['Verify', 'lucide-circle-dot', 'status-pulse'],
  ['Ready to merge', 'lucide-git-merge', 'status-pulse'],
] as const)('%s animates its own icon while running', (status, icon, motion) => {
  const html = renderToStaticMarkup(createElement(StatusGlyph, { status, running: true }));
  expect(html).toContain(icon);
  expect(html).toContain(motion);
});

test.each(['List', 'Queued', 'Ready', 'Needs you', 'Done'] as const)('%s stays still even with running activity', status => {
  expect(renderToStaticMarkup(createElement(StatusGlyph, { status, running: true }))).not.toMatch(/status-pulse|status-spin/);
});
