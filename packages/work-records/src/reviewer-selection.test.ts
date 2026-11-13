import {
    defaultFactorySettings,
    type ReviewerDefinition,
    type ReviewerTrigger,
} from '@lar-factory/shared/factory-settings';
import { describe, expect, it } from 'vite-plus/test';

import { selectReviewers, type ReviewDiff } from './reviewer-selection.ts';

const diff = (path: string, text: string | null = ''): ReviewDiff => ({ files: [{ path, text }], complete: true });
const select = (input: ReviewDiff) => selectReviewers(defaultFactorySettings(), input);
const axis = (id: string, input: ReviewDiff) => select(input).find((entry) => entry.id === id)!;
const custom = (trigger: ReviewerTrigger): ReviewerDefinition => ({
    id: 'custom',
    name: 'Custom',
    mode: { kind: 'on-trigger', trigger },
    instructions: { kind: 'revision', revision: 1 },
    revisions: [{ revision: 1, text: 'Check compatibility.' }],
});
const rules = (target: 'path-glob' | 'diff-text', pattern: string): ReviewerTrigger => ({
    version: 1,
    kind: 'rules',
    any: [{ target, pattern }],
});
const customResult = (trigger: ReviewerTrigger, input: ReviewDiff) =>
    selectReviewers({ ...defaultFactorySettings(), reviewers: [custom(trigger)] }, input).find(
        (entry) => entry.id === 'custom',
    )!;

describe('version 1 built-in reviewer policies', () => {
    it('always runs Code, and skips conditional reviewers for an empty or plain documentation diff', () => {
        for (const input of [{ files: [], complete: true }, diff('README.md', 'Improve the explanation.')]) {
            expect(
                select(input)
                    .filter((entry) => entry.run)
                    .map((entry) => entry.id),
            ).toEqual(['code']);
            expect(select(input).every((entry) => entry.triggerVersion === 1 && entry.reason.length > 0)).toBe(true);
        }
    });
    it.each([
        'src/auth.ts',
        'src/sessions.ts',
        'src/permissions.ts',
        'src/input.ts',
        'src/validation.ts',
        'src/filesystem.ts',
        'src/uploads.ts',
        'scripts/build.sh',
        'package.json',
        'pnpm-lock.yaml',
        '.github/workflows/test.yml',
        'ci/build.yml',
        'src/secrets.ts',
        'src/network.ts',
    ])('matches Security path %s', (path) => {
        expect(axis('security', diff(path))).toMatchObject({ run: true, outcome: 'matched', rule: 'security.path' });
    });
    it.each([
        'request.body',
        'authorize(user)',
        'session.cookie',
        'permissions.check()',
        'readFile(path)',
        'path.resolve(input)',
        'upload(file)',
        'execFile(command)',
        'process.env.KEY',
        'fetch(url)',
    ])('matches Security symbol %s beyond filenames', (text) => {
        expect(axis('security', diff('src/ordinary.ts', text))).toMatchObject({
            outcome: 'matched',
            rule: 'security.text',
        });
    });
    it.each(['apps/web/src/service.ts', 'ui/Dialog.ts', 'app.css', 'Screen.swift', 'view.storyboard', 'logo.png'])(
        'matches UI path %s',
        (path) => {
            expect(axis('ui', diff(path))).toMatchObject({ run: true, outcome: 'matched', rule: 'ui.path' });
        },
    );
    it.each(['<button>Save</button>', 'Text("Hello")', 'node.textContent = value', 'aria-label'])(
        'matches UI symbol %s',
        (text) => {
            expect(axis('ui', diff('src/ordinary.ts', text))).toMatchObject({ outcome: 'matched', rule: 'ui.text' });
        },
    );
    it.each([
        'src/render.ts',
        'src/poll.ts',
        'src/queries.ts',
        'db/list.sql',
        'bundle.js',
        'vite.config.ts',
        'package.json',
    ])('matches Performance path %s', (path) => {
        expect(axis('performance', diff(path))).toMatchObject({ outcome: 'matched', rule: 'performance.path' });
    });
    it.each([
        'render(tree)',
        'setInterval(tick)',
        'SELECT * FROM items',
        'for (const item of items)',
        'items.map(fn)',
        'while (next)',
    ])('matches Performance symbol %s', (text) => {
        expect(axis('performance', diff('src/ordinary.ts', text))).toMatchObject({
            outcome: 'matched',
            rule: 'performance.text',
        });
    });
    it.each([diff('src/opaque.unknown', 'perform_action();'), diff('notes.md', null), { files: [], complete: false }])(
        'runs uncertain policies with evidence',
        (input) => {
            expect(select(input).every((entry) => entry.run)).toBe(true);
            expect(axis('security', input)).toMatchObject({ outcome: 'uncertain' });
            expect(axis('security', input).evidence).not.toBe('');
        },
    );
    it('skips policies for complete recognized source without signals instead of treating all source as uncertain', () => {
        expect(
            select(diff('src/arithmetic.ts', 'return left + right;'))
                .filter((entry) => entry.run)
                .map((entry) => entry.id),
        ).toEqual(['code']);
    });
    it('honors never even for Code and uncertain or positively matched changes; honors always without a match', () => {
        const settings = defaultFactorySettings();

        settings.reviewers[0]!.mode = { kind: 'never' };
        settings.reviewers[1]!.mode = { kind: 'never' };
        settings.reviewers[2]!.mode = { kind: 'always' };
        for (const input of [diff('auth.ts'), { files: [], complete: false }]) {
            const selected = selectReviewers(settings, input);

            expect(selected.find((entry) => entry.id === 'security')).toMatchObject({ run: false, rule: 'mode.never' });
            expect(selected.find((entry) => entry.id === 'code')!.run).toBe(false);
            expect(selected.find((entry) => entry.id === 'ui')!.run).toBe(true);
        }
    });
});

describe('custom version 1 rules', () => {
    it.each([
        ['src/**/*.ts', 'src/a.ts', true],
        ['src/**/*.ts', 'src/deep/a.ts', true],
        ['src/*.ts', 'src/deep/a.ts', false],
        ['**/a?.ts', 'a1.ts', true],
        ['**/*.ts', '.hidden/a.ts', true],
        ['Src/*.ts', 'src/a.ts', false],
    ])('matches glob %s against %s', (pattern, path, run) => {
        expect(customResult(rules('path-glob', pattern), diff(path)).run).toBe(run);
    });
    it('matches literal, case-sensitive diff text, including regex punctuation, and returns saved instructions', () => {
        expect(customResult(rules('diff-text', 'call(a.*)'), diff('src/a.ts', 'call(a.*)'))).toMatchObject({
            run: true,
            outcome: 'matched',
            instructions: { revision: 1, text: 'Check compatibility.' },
        });
        expect(customResult(rules('diff-text', 'call(a.*)'), diff('src/a.ts', 'Call(abc)')).run).toBe(false);
    });
    it('runs for unknown content, unavailable paths and unsupported glob syntax', () => {
        for (const input of [diff('blob.bin', null), { files: [], complete: false }])
            expect(customResult(rules('diff-text', 'needle'), input)).toMatchObject({
                run: true,
                outcome: 'uncertain',
            });
        expect(customResult(rules('path-glob', '[ab].ts'), diff('c.ts'))).toMatchObject({
            run: true,
            outcome: 'uncertain',
        });
        expect(customResult(rules('path-glob', '**/*.ts'), diff('blob.bin', null)).run).toBe(false);
    });
    it('lets any definite match establish evidence even when another rule was uncertain', () => {
        expect(
            customResult(
                {
                    version: 1,
                    kind: 'rules',
                    any: [
                        { target: 'diff-text', pattern: 'needle' },
                        { target: 'path-glob', pattern: '*.bin' },
                    ],
                },
                diff('blob.bin', null),
            ),
        ).toMatchObject({ outcome: 'matched', rule: 'custom.any.2.path-glob' });
    });
    it('is stable across repeated calls and input order without mutating settings or diffs', () => {
        const settings = defaultFactorySettings();
        const input = { files: [...diff('z/auth.ts').files, ...diff('a/auth.ts').files], complete: true };
        const before = structuredClone({ settings, input });
        const expected = JSON.stringify(selectReviewers(settings, input));

        expect({ settings, input }).toEqual(before);
        expect(
            JSON.stringify(
                selectReviewers(
                    { ...settings, reviewers: [...settings.reviewers].reverse() },
                    {
                        ...input,
                        files: [...input.files].reverse(),
                    },
                ),
            ),
        ).toBe(expected);
        expect(JSON.stringify(selectReviewers(settings, input))).toBe(expected);
    });
    it('honors custom always and never modes independently of content availability', () => {
        for (const kind of ['always', 'never'] as const) {
            const reviewer = { ...custom(rules('diff-text', 'needle')), mode: { kind } };
            const selected = selectReviewers({ version: 1, reviewers: [reviewer] }, { files: [], complete: false });

            expect(selected.find((entry) => entry.id === 'custom')).toMatchObject({
                run: kind === 'always',
                rule: `mode.${kind}`,
            });
        }
    });
    it('rejects unknown trigger versions instead of silently applying current semantics', () => {
        const reviewer = custom(rules('path-glob', '*'));

        expect(() =>
            selectReviewers(
                {
                    version: 1,
                    reviewers: [
                        {
                            ...reviewer,
                            mode: {
                                kind: 'on-trigger',
                                trigger: { version: 2, kind: 'rules', any: [] },
                            },
                        },
                    ],
                },
                diff('a'),
            ),
        ).toThrow('Invalid factory settings');
    });
});
