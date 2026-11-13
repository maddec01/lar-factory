// Machine-wide workflow choices. No filesystem or provider access: both the server and lar-work use this contract.
import type { ModelChoice } from './board-domain.ts';

export const THREAD_KINDS = ['shaping', 'concept', 'decision', 'build'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export const FACTORY_ROLES = [
    'explore',
    'diagnose',
    'research',
    'prototype',
    'planner',
    'implementer',
    'checks',
    'domain-docs',
    'fixer',
    'approver',
    'ci-fixer',
    'doubt',
] as const;
export type FactoryRole = (typeof FACTORY_ROLES)[number] | `reviewer:${string}`;
export const BUILTIN_REVIEWERS = ['code', 'security', 'ui', 'performance'] as const;
export type BuiltinReviewer = (typeof BUILTIN_REVIEWERS)[number];

/** Absent fields inherit independently. Provider support is checked at launch, never guessed by the settings store. */
export interface ExecutionOverride {
    model?: ModelChoice;
    effort?: string;
}

/** Named policies refer to today's builder.md Review section. The reviewer matcher owns their deterministic interpretation. */
export type ReviewerTrigger =
    | { version: 1; kind: 'policy'; policy: Exclude<BuiltinReviewer, 'code'> }
    | { version: 1; kind: 'rules'; any: { target: 'path-glob' | 'diff-text'; pattern: string }[] };

export type ReviewerMode = { kind: 'always' } | { kind: 'never' } | { kind: 'on-trigger'; trigger: ReviewerTrigger };
export interface ReviewerDefinition {
    /** Built-ins keep the old review axis IDs; custom IDs do not depend on their editable names. */
    id: string;
    name: string;
    mode: ReviewerMode;
    instructions: { kind: 'builtin'; reviewer: BuiltinReviewer } | { kind: 'revision'; revision: number };
    /** Append-only edited copies. The selected revision can be changed without erasing history. */
    revisions: { revision: number; text: string }[];
}

export interface FactorySettings {
    version: 1;
    threadKinds: Partial<Record<ThreadKind, ExecutionOverride>>;
    roles: Partial<Record<FactoryRole, ExecutionOverride>>;
    reviewers: ReviewerDefinition[];
}

/** Fresh values on every call: callers can edit a draft without changing anyone else's defaults. */
export function defaultFactorySettings(): FactorySettings {
    return {
        version: 1,
        threadKinds: {},
        roles: {},
        reviewers: BUILTIN_REVIEWERS.map((id) => ({
            id,
            name: id === 'ui' ? 'UI' : id[0]!.toUpperCase() + id.slice(1),
            mode:
                id === 'code'
                    ? { kind: 'always' }
                    : { kind: 'on-trigger', trigger: { version: 1, kind: 'policy', policy: id } },
            instructions: { kind: 'builtin', reviewer: id },
            revisions: [],
        })),
    };
}
