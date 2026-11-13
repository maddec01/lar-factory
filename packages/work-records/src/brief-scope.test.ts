import { describe, expect, it } from 'vite-plus/test';

import { checkBriefScope, parseBriefScope, scopeMarkdown, type BriefScope } from './brief-scope.ts';

const scope: BriefScope = {
    files: ['cli.js', 'test/cli.test.js'],
    tests: ['Named/default/padded input, ignored extras: exact subprocess stdout, stderr and exit status.'],
    behaviour: ['Greet the first argument with the existing API; default to world.'],
    excluded: ['No README examples, dependencies or follow-ups.'],
    size: 'Small',
    verify: { required: false, visibleUi: null },
};

describe('brief scope comparison', () => {
    it('preserves exact scope while allowing ordinary handover prose and harmless formatting', () => {
        const brief = `## What\nCLI greeting\n${scopeMarkdown(scope)}\n## Confirmed\nThe API stays unchanged.\n## Domain docs\nnone\n`;

        expect(checkBriefScope(scope, brief.replace('- cli.js', '* cli.js'))).toMatchObject({
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
                { field: 'scope.files', value: 'cli.js' },
                { field: 'scope.files', value: 'test/cli.test.js' },
                { field: 'scope.size', value: 'Small' },
                { field: 'done when.tests', value: scope.tests[0] },
                { field: 'verify', value: 'no' },
            ]),
        );
        expect(result.extra).toEqual([
            { field: 'done when', value: 'README examples show named and default invocations.' },
            { field: 'verify', value: 'yes: CLI output is visible' },
        ]);
    });

    it('rejects lost/extra/negated claims, duplicate assertions and changed size or Verify', () => {
        const brief = scopeMarkdown(scope)
            .replace('- cli.js', '- README.md')
            .replace(`- ${scope.tests[0]}`, `- Do not ${scope.tests[0]}`)
            .replace('Small', 'Larger')
            .replace('\nno\n', '\nyes: visible terminal\n')
            .replace('- test/cli.test.js', '- test/cli.test.js\n- test/cli.test.js');
        const result = checkBriefScope(scope, brief);

        expect(result.missing).toHaveLength(4);
        expect(result.extra).toHaveLength(5);
        expect(result.extra).toContainEqual({ field: 'scope.files', value: 'README.md' });
        expect(result.extra).toContainEqual({ field: 'scope.files', value: 'test/cli.test.js' });
    });

    it('allows refinement of unstated constraints without inventing a confirmed boundary', () => {
        const open: BriefScope = { ...scope, files: [], tests: [], excluded: [], size: null };

        expect(checkBriefScope(open, scopeMarkdown(scope)).ok).toBe(true);
        expect(checkBriefScope(scope, null)).toMatchObject({ ok: false, briefDigest: null, extra: [] });
    });

    it('counts explicit file declarations elsewhere in the brief as scope too', () => {
        const brief = `${scopeMarkdown(scope)}\n## Notes for the builder\nFiles: \`README.md\``;

        expect(checkBriefScope(scope, brief)).toMatchObject({
            ok: false,
            missing: [],
            extra: [{ field: 'scope.files', value: 'README.md' }],
        });
    });

    it('carries visible UI Verify steps and rejects an opposite decision', () => {
        const ui: BriefScope = { ...scope, verify: { required: true, visibleUi: 'Check the menu at 390px.' } };

        expect(checkBriefScope(ui, scopeMarkdown(ui)).ok).toBe(true);
        expect(checkBriefScope(ui, scopeMarkdown(scope))).toMatchObject({
            ok: false,
            missing: [{ field: 'verify', value: 'yes: Check the menu at 390px.' }],
            extra: [{ field: 'verify', value: 'no' }],
        });
    });
});

describe('scope input boundary', () => {
    it.each([
        null,
        [],
        {},
        { ...scope, extra: 'field' },
        { ...scope, tests: 'pnpm test' },
        { ...scope, files: ['cli.js', 'cli.js'] },
        { ...scope, behaviour: [] },
        { ...scope, behaviour: ['okay\n## Verify\nyes'] },
        { ...scope, size: 'tiny' },
        { ...scope, verify: { required: true, visibleUi: null } },
        { ...scope, verify: { required: false, visibleUi: 'CLI output' } },
    ])('rejects malformed or contradictory scope %#', (value) => {
        expect(() => parseBriefScope(value)).toThrow('Scope needs');
    });
});
