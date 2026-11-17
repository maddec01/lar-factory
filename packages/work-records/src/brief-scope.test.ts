import { describe, expect, it } from 'vite-plus/test';

import { checkBriefScope, scopeMarkdown, type BriefScope } from './brief-scope.ts';

const scope: BriefScope = {
    tests: ['Named/default/padded input, ignored extras: exact subprocess stdout, stderr and exit status.'],
    behaviour: ['Greet the first argument with the existing API; default to world.'],
    excluded: ['No README examples, dependencies or follow-ups.'],
    size: 'Small',
    verify: { required: false, visibleUi: null },
};

describe('brief scope comparison', () => {
    it('preserves exact scope while allowing ordinary handover prose and harmless formatting', () => {
        const brief = `## What\nCLI greeting\n${scopeMarkdown(scope)}\n## Confirmed\nThe API stays unchanged.\n## Domain docs\nnone\n`;

        expect(checkBriefScope(scope, brief.replace('- No README', '* No README'))).toMatchObject({
            ok: true,
            missing: [],
            extra: [],
            briefDigest: expect.any(String),
        });
    });

    it('catches the S01 first-brief failure before a human gate', () => {
        const result = checkBriefScope(
            scope,
            '## What\nCLI greeting\n## Done when\n- README examples show named and default invocations.\n## Verify\nyes: CLI output is visible\n',
        );

        expect(result.ok).toBe(false);
        expect(result.missing).toEqual(
            expect.arrayContaining([
                { field: 'scope.size', value: 'Small' },
                { field: 'done when.tests', value: scope.tests[0] },
            ]),
        );
        expect(result.extra).toEqual([
            { field: 'done when', value: 'README examples show named and default invocations.' },
            { field: 'verify', value: 'yes: CLI output is visible' },
        ]);
    });

    it('renders no Files heading and passes an older brief that still lists files', () => {
        const rendered = scopeMarkdown(scope);
        const older = `${rendered.replace('## Scope\n', '## Scope\n### Files\n- cli.js\n')}\n## Notes for the builder\nFiles: \`README.md\``;

        expect(rendered).not.toContain('### Files');
        expect(rendered).not.toContain('## Verify');
        expect(checkBriefScope(scope, `${older}\n## Verify\nno\n`).ok).toBe(true);
        expect(checkBriefScope(scope, older)).toMatchObject({ ok: true, missing: [], extra: [] });
    });
});
