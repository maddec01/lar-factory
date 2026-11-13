import type { ModelSelection } from './board-domain.ts';
import { parseFactorySettings } from './factory-settings-parse.ts';
import {
    FACTORY_ROLES,
    THREAD_KINDS,
    type ExecutionOverride,
    type FactoryRole,
    type ReviewerDefinition,
    type ThreadKind,
} from './factory-settings.ts';

interface ResolutionContext {
    /** Today's T3 project selection, including its model-specific options. Omit to retain a symbolic Project default. */
    projectDefault?: ModelSelection | null;
    /** The actual owning thread's choice, including a manual Start selection. Roles inherit this when supplied. */
    threadSelection?: ModelSelection | null;
}

function apply(
    base: ModelSelection | null,
    override: ExecutionOverride,
    project: ModelSelection | null,
): ModelSelection | null {
    if (!override.model) return base;

    // Options belong to a model. Explicit choices use project options only for that same model, as Start does today.
    const source = [base, project].find(
        (entry) => entry?.instanceId === override.model!.instanceId && entry.model === override.model!.model,
    );

    return { ...override.model, ...(source?.options ? { options: source.options } : {}) };
}

const effortOf = (selection: ModelSelection | null) => {
    const value = selection?.options?.find((entry) => entry.id === 'effort' || entry.id === 'reasoningEffort')?.value;

    return typeof value === 'string' ? value : null;
};

/**
 * Resolve machine choices without I/O. Null model/effort means inherit T3's default, never a hard-coded vendor.
 * Reviewers are the enabled policy set, with conditional triggers retained for the reviewer matcher; this does not match a diff.
 * Effort is returned separately so the execution bridge can use the selected provider's advertised option ID.
 */
export function resolveFactorySettings(
    settings: unknown,
    kind: ThreadKind,
    role?: FactoryRole,
    context: ResolutionContext = {},
) {
    const parsed = parseFactorySettings(settings);

    if (!THREAD_KINDS.includes(kind)) throw new Error(`Unknown thread kind: ${kind}.`);

    const roles: string[] = [...FACTORY_ROLES, ...parsed.reviewers.map((entry) => `reviewer:${entry.id}`)];

    if (role !== undefined && !roles.includes(role)) throw new Error(`Unknown factory role: ${role}.`);

    const project = context.projectDefault ?? null;
    const kindOverride = parsed.threadKinds[kind] ?? {};
    const thread =
        context.threadSelection !== undefined ? context.threadSelection : apply(project, kindOverride, project);
    const threadEffort =
        context.threadSelection !== undefined ? effortOf(thread) : (kindOverride.effort ?? effortOf(thread));
    const roleOverride = role ? (parsed.roles[role] ?? {}) : {};
    const selection = apply(thread, roleOverride, project);

    return structuredClone({
        model: selection ? { instanceId: selection.instanceId, model: selection.model } : null,
        effort: roleOverride.effort ?? threadEffort,
        // Return non-effort options separately to avoid a contradictory effort in a model selection.
        options: selection?.options?.filter((entry) => !['effort', 'reasoningEffort'].includes(entry.id)) ?? [],
        reviewers: parsed.reviewers.filter((entry) => entry.mode.kind !== 'never'),
    });
}

/** A trusted skill-relative reference for built-ins; custom text is data, never a filesystem path. */
export function reviewerInstructions(
    reviewer: ReviewerDefinition,
): { path: string } | { text: string; revision: number } {
    const settings = parseFactorySettings({ version: 1, reviewers: [reviewer] });
    const valid = settings.reviewers.find((entry) => entry.id === reviewer.id)!;

    if (valid.instructions.kind === 'builtin')
        return { path: `skills/lar-build/agents/reviewer-${valid.instructions.reviewer}.md` };

    return valid.revisions[valid.instructions.revision - 1]!;
}
