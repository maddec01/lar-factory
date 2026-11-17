import { expect, test } from 'vite-plus/test';

import { formatTicketSpec, readTicketSpec } from './ticket-spec.ts';
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
    expect(readTicketSpec(formatTicketSpec('Whole brief.  \n', 'Authored request.'))).toMatchObject({
        marked: true,
        spec: 'Whole brief.  \n',
        original: 'Authored request.',
    });
    expect(readTicketSpec('Markerless edit.')).toEqual({ marked: false, spec: 'Markerless edit.', original: null });
});

test.each(['markdown', 'html'] as const)(
    'an empty Original keeps the %s Spec replaceable without a collapsed block',
    (format) => {
        const marker = '<!-- lar-factory:create {"identity":"11111111-1111-4111-8111-111111111111"} -->';
        const options = format === 'html' ? { format } : undefined;
        const body = formatTicketSpec('## What\nBuild it.  \n', `\n\n${marker}`, options);
        const parsed = readTicketSpec(body);

        expect(parsed).toEqual({
            marked: true,
            spec: format === 'html' ? trackerMarkdownHtml('## What\nBuild it.  \n') : '## What\nBuild it.  \n',
            original: '',
        });
        expect(body).not.toContain('<details>');
        expect(body).not.toContain('lar-factory:create');
        expect(readTicketSpec(formatTicketSpec('Revised Spec.', parsed.original!, options))).toMatchObject({
            marked: true,
            original: '',
        });
        expect(readTicketSpec(formatTicketSpec('Spec.', `Authored request.\n\n${marker}`, options)).original).toContain(
            'Authored request.',
        );
    },
);

test.each(['markdown', 'html'] as const)(
    'linked %s Specs publish acceptance prose without local declarations',
    (format) => {
        const spec =
            '## What\nUse the producer output.\n\n## Done when\n### Behaviour\n- Accept the producer fixtures.\n\n## Tests\n- Fixtures pass through the public renderer.\n\n## Notes for the builder\nBlocked by: `Producer`\nConsumes: `Producer`\nProduces: `Rendered output`\nContracts: `Shared output`\nParent contract: `Parent`\nNo ordering needed: `Independent`: compatible in either order.\nConsumption test: {"source":"Producer","test":"view.test.js: renders fixtures","input":"render(output)","output":"fixture"}';
        const body = formatTicketSpec(spec, 'Original request.', format === 'html' ? { format } : undefined);

        expect(body).toContain('Accept the producer fixtures.');
        expect(body).not.toMatch(
            /Blocked by:|Consumes:|Produces:|Contracts:|Parent contract:|No ordering needed:|Consumption test:|Notes for the builder/,
        );
        expect(body).not.toMatch(/^## Tests$|<h2>Tests<\/h2>/m);
        expect(body).toContain(format === 'html' ? '<h3>Tests</h3>' : '### Tests');
        expect(readTicketSpec(body).original).toContain('Original request.');
    },
);
