import { expect, test } from 'vite-plus/test';
import { trackerMarkdownHtml } from './tracker-markdown.ts';
import { formatTicketSpec } from './ticket-spec.ts';

test('the whole Spec precedes a collapsed Original with stable delimiters', () => {
  expect(formatTicketSpec('## What\nBuild it.\n', 'Original request.')).toBe('<!-- lar-factory:spec -->\n## What\nBuild it.\n\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n\nOriginal request.\n\n</details>\n<!-- lar-factory:end -->');
});

test('Azure conversion preserves the Spec delimiters and collapsed Original while escaping authored HTML', () => {
  const html = trackerMarkdownHtml(formatTicketSpec('## What\nBuild it.', 'Original.\n\n<script>alert(1)</script>'));
  expect(html).toContain('<!-- lar-factory:spec -->');
  expect(html).toContain('<details>\n<summary>Original</summary>');
  expect(html).toContain('<h2>What</h2>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
});

test('the formatter preserves the exact brief bytes for its gate copy', () => {
  expect(formatTicketSpec('Spec ending.  \n', '')).toContain('Spec ending.  \n\n\n<!-- lar-factory:original -->');
});
