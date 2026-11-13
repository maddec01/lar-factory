import {
    BUILTIN_REVIEWERS,
    reviseReviewerInstructions,
    type BuiltinReviewer,
    type FactorySettings,
    type ReviewerDefinition,
} from '@lar-factory/shared/factory-settings';

export const builtinReviewer = (id: string): id is BuiltinReviewer =>
    BUILTIN_REVIEWERS.some((builtin) => builtin === id);
export function instructionText(reviewer: ReviewerDefinition, defaults: Record<BuiltinReviewer, string>): string {
    return reviewer.instructions.kind === 'builtin'
        ? defaults[reviewer.instructions.reviewer]
        : (reviewer.revisions!.find(
              (entry) =>
                  entry.revision === (reviewer.instructions.kind === 'revision' ? reviewer.instructions.revision : 0),
          )?.text ?? '');
}

/** A text draft becomes exactly one revision on Save, never a revision for each keystroke. */
export function prepareFactoryDraft(settings: FactorySettings, texts: Record<string, string>): FactorySettings {
    for (const reviewer of settings.reviewers) {
        if (!reviewer.name.trim()) throw new Error('Enter a name for every reviewer.');

        const text = texts[reviewer.id];

        if (builtinReviewer(reviewer.id) && text !== undefined)
            throw new Error('Duplicate a packaged reviewer before editing it.');

        if (text !== undefined && !text.trim()) throw new Error(`Enter instructions for ${reviewer.name}.`);

        if (
            reviewer.mode.kind === 'on-trigger' &&
            reviewer.mode.trigger.kind === 'rules' &&
            reviewer.mode.trigger.any.some((rule) => !rule.pattern.trim())
        )
            throw new Error(`Enter a pattern for every ${reviewer.name} trigger rule.`);
    }

    let result = structuredClone(settings);

    // New reviewers start with their first instruction revision.
    for (const reviewer of result.reviewers) {
        if (reviewer.instructions.kind === 'revision' && !reviewer.revisions!.length) {
            reviewer.revisions!.push({ revision: 1, text: texts[reviewer.id] ?? '' });
        }
    }
    for (const [id, text] of Object.entries(texts)) {
        const reviewer = result.reviewers.find((entry) => entry.id === id);

        if (
            !reviewer ||
            (reviewer.instructions.kind === 'revision' &&
                reviewer.revisions!.find(
                    (entry) => entry.revision === (reviewer.instructions as { revision: number }).revision,
                )?.text === text)
        )
            continue;

        result = reviseReviewerInstructions(result, id, text);
    }

    return result;
}
