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
    it('matches Security by path and by symbol beyond filenames', () => {
        expect(axis('security', diff('src/auth.ts'))).toMatchObject({
            run: true,
            outcome: 'matched',
            rule: 'security.path',
        });
        expect(axis('security', diff('src/ordinary.ts', 'fetch(url)'))).toMatchObject({
            outcome: 'matched',
            rule: 'security.text',
        });
    });
    it('matches UI and Performance paths', () => {
        expect(axis('ui', diff('ui/Dialog.ts'))).toMatchObject({ run: true, outcome: 'matched', rule: 'ui.path' });
        expect(axis('performance', diff('src/render.ts'))).toMatchObject({
            outcome: 'matched',
            rule: 'performance.path',
        });
    });
    it('runs uncertain policies with evidence when the diff is unavailable', () => {
        const input = { files: [], complete: false };

        expect(select(input).every((entry) => entry.run)).toBe(true);
        expect(axis('security', input)).toMatchObject({ outcome: 'uncertain' });
        expect(axis('security', input).evidence).not.toBe('');
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
    it('matches a custom path glob', () => {
        expect(customResult(rules('path-glob', 'src/**/*.ts'), diff('src/deep/a.ts')).run).toBe(true);
        expect(customResult(rules('path-glob', 'src/*.ts'), diff('src/deep/a.ts')).run).toBe(false);
    });
    it('matches literal, case-sensitive diff text, including regex punctuation, and returns saved instructions', () => {
        expect(customResult(rules('diff-text', 'call(a.*)'), diff('src/a.ts', 'call(a.*)'))).toMatchObject({
            run: true,
            outcome: 'matched',
            instructions: { revision: 1, text: 'Check compatibility.' },
        });
        expect(customResult(rules('diff-text', 'call(a.*)'), diff('src/a.ts', 'Call(abc)')).run).toBe(false);
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
