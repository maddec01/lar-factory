import {
    builtinReviewerMode,
    defaultFactorySettings,
    type FactoryRole,
    type FactorySettings,
    type ReviewerDefinition,
} from './factory-settings.ts';

export type LegacyReviewer = Omit<ReviewerDefinition, 'revisions'> & {
    revisions: { revision: number; text: string }[];
};

/** Deterministic read-time upgrade. The next Save persists v2; repeated reads never multiply copies. */
export function migrateReviewerEdits(settings: FactorySettings): FactorySettings {
    const legacy = settings.reviewers as LegacyReviewer[];
    const ids = new Set(legacy.map((entry) => entry.id));
    const reviewers: ReviewerDefinition[] = [];

    for (const entry of legacy) {
        const builtin = defaultFactorySettings().reviewers.find((candidate) => candidate.id === entry.id);

        if (!builtin) {
            reviewers.push(entry as ReviewerDefinition);
            continue;
        }

        const edited = entry.instructions.kind === 'revision';

        reviewers.push({
            ...builtin,
            mode: builtinReviewerMode(builtin.id as never, edited ? 'never' : entry.mode.kind),
        });

        if (!entry.revisions?.length) continue;

        const base = `custom-${entry.id}-copy`;
        let id = base;

        for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
        ids.add(id);
        reviewers.push({
            ...entry,
            id,
            name: `${entry.name} (copy)`,
            mode: edited ? entry.mode : { kind: 'never' },
            ...(entry.mode.kind === 'on-trigger' ? { trigger: entry.mode.trigger } : {}),
            instructions: {
                kind: 'revision',
                revision:
                    edited && entry.instructions.kind === 'revision'
                        ? entry.instructions.revision
                        : entry.revisions.length,
            },
        });

        const role: FactoryRole = `reviewer:${entry.id}`;

        if (settings.roles[role]) settings.roles[`reviewer:${id}`] = structuredClone(settings.roles[role]);
    }

    return { ...settings, reviewers };
}
