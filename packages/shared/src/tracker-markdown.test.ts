import { expect, test } from 'vite-plus/test';
import { readTrackerStructure, writeTrackerStructure } from './tracker-structure.ts';
import { trackerMarkdownHtml } from './tracker-markdown.ts';

test('tracker Markdown becomes HTML while active HTML and unsafe links remain inert', () => {
  const html = trackerMarkdownHtml('## Steps\n\n- **Play**\n- Quit\n\n<script>alert(1)</script>\n\n[x](javascript:alert)\n\n<!-- lar-factory:create {"identity":"request"} -->');
  expect(html).toContain('<h2>Steps</h2>');
  expect(html).toContain('<li><strong>Play</strong></li>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('<!-- lar-factory:create {"identity":"request"} -->');
});


test.each(['--!>', '>', '->'])('malformed marker terminator %s cannot expose active HTML', terminator => {
  const html = trackerMarkdownHtml(`<!-- lar-factory:spec ${terminator}<img src=x onerror=alert(1)><!-- -->`);
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
});


test('valid structure markers retain JSON containing dashes and HTML comment terminators safely', () => {
  const structure = { version: 1 as const, kind: 'concept' as const, map: 'A --> B\nUse --strict.\n<!-- --!><img src=x onerror=alert(1)> -->' };
  const html = trackerMarkdownHtml(writeTrackerStructure('', structure));
  expect(readTrackerStructure(html)).toEqual(structure);
  expect(html).not.toContain('<img');
  expect(html).not.toContain('--!>');
});
