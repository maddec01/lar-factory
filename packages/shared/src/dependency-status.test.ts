import { expect, test } from 'vite-plus/test';

import { hasDependencyStatusProse, markDependencyStatus } from './dependency-status.ts';
import { formatTicketSpec, readTicketSpec, markSpecFreshness } from './ticket-spec.ts';

test('generated proof facts escape external text and stay outside retained Markdown and Azure HTML Specs', () => {
    for (const html of [false, true]) {
        const body = formatTicketSpec(
            'Require proof before activation.  \n',
            'Original',
            html ? { format: 'html' } : undefined,
        );
        const annotated = markDependencyStatus(markSpecFreshness(body, true), [
            {
                owner: '<script>team</script>',
                need: 'v1',
                evidence: 'Verified <img src=x>',
                met: { by: 'Pedro', at: 'now' },
                needsReview: true,
            },
        ]);

        expect(annotated).toContain('&lt;script&gt;');
        expect(annotated).not.toContain('<script>');
        expect(annotated).toContain('Met by Pedro');
        expect(readTicketSpec(annotated)).toEqual(readTicketSpec(body));
        expect(markDependencyStatus(annotated, [])).toBe(markSpecFreshness(body, true));
    }
});

test('the legacy prose guard leaves product requirements and fenced examples intact', () => {
    expect(hasDependencyStatusProse('No proof has been supplied.')).toBe(true);
    expect(hasDependencyStatusProse('Require verified proof before acceptance.')).toBe(false);
    expect(hasDependencyStatusProse('```text\nNo proof has been supplied.\n```')).toBe(false);
});
