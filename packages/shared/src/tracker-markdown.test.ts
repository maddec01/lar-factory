import { expect, test } from 'vite-plus/test';

import { trackerMarkdownHtml } from './tracker-markdown.ts';

test('tracker Markdown becomes HTML while active HTML and unsafe links remain inert', () => {
    const html = trackerMarkdownHtml(
        '## Steps\n\n- **Play**\n- Quit\n\n<script>alert(1)</script>\n\n[x](javascript:alert)\n\n<!-- lar-factory:create {"identity":"request"} -->',
    );

    expect(html).toContain('<h2>Steps</h2>');
    expect(html).toContain('<li><strong>Play</strong></li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<!-- lar-factory:create {"identity":"request"} -->');
});

test('malformed marker terminator --!> cannot expose active HTML', () => {
    const html = trackerMarkdownHtml(`<!-- lar-factory:spec --!><img src=x onerror=alert(1)><!-- -->`);

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
});
