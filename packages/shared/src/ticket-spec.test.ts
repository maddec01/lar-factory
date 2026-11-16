import { expect, test } from 'vite-plus/test';

import { formatTicketSpec } from './ticket-spec.ts';
import { trackerMarkdownHtml } from './tracker-markdown.ts';

test('Azure conversion preserves the Spec delimiters and collapsed Original while escaping authored HTML', () => {
    const html = trackerMarkdownHtml(formatTicketSpec('## What\nBuild it.', 'Original.\n\n<script>alert(1)</script>'));

    expect(html).toContain('<!-- lar-factory:spec -->');
    expect(html).toContain('<details>\n<summary>Original</summary>');
    expect(html).toContain('<h2>What</h2>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
});

test('reading a marked ticket restores only Original and preserves exact Spec bytes', async () => {
    const { readTicketSpec } = await import('./ticket-spec.ts');

    expect(readTicketSpec(formatTicketSpec('Whole brief.  \n', 'Authored request.'))).toMatchObject({
        marked: true,
        spec: 'Whole brief.  \n',
        original: 'Authored request.',
    });
    expect(readTicketSpec('Markerless edit.')).toEqual({ marked: false, spec: 'Markerless edit.', original: null });
});
