import { parseFactorySettings } from './factory-settings-parse.ts';
import { builtinReviewerMode, BUILTIN_REVIEWERS, type FactorySettings } from './factory-settings.ts';

/** Copy packaged text now, so later package updates cannot rewrite the user's custom instructions. */
export function duplicateReviewer(
    settings: FactorySettings,
    reviewerId: string,
    id: string,
    packagedText: string,
): FactorySettings {
    const next = structuredClone(settings);
    const source = next.reviewers.find((entry) => entry.id === reviewerId);

    if (!source || next.reviewers.some((entry) => entry.id === id))
        throw new Error('Choose a known reviewer and a new ID.');

    const text =
        source.instructions.kind === 'builtin'
            ? packagedText
            : source.revisions![source.instructions.revision - 1]!.text;
    const packaged =
        source.instructions.kind === 'builtin' ? builtinReviewerMode(source.instructions.reviewer, 'on-trigger') : null;
    const trigger =
        packaged?.kind === 'on-trigger'
            ? packaged.trigger
            : source.mode.kind === 'on-trigger'
              ? source.mode.trigger
              : source.trigger;
    const copy = {
        id,
        name: `${source.name} (copy)`,
        mode: structuredClone(source.mode),
        ...(trigger ? { trigger: structuredClone(trigger) } : {}),
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text }],
    };
    const valid = parseFactorySettings({ version: 2, reviewers: [copy] }).reviewers.find((entry) => entry.id === id)!;

    next.reviewers.push(valid);

    return next;
}

/** Only custom instructions have editable, append-only revisions. */
export function reviseReviewerInstructions(
    settings: FactorySettings,
    reviewerId: string,
    instructions: string,
): FactorySettings {
    const next = parseFactorySettings(settings);
    const target = next.reviewers.find((entry) => entry.id === reviewerId);

    if (!target || !instructions.trim()) throw new Error('A known reviewer and non-empty instructions are required.');

    if (BUILTIN_REVIEWERS.includes(target.id as never) || !target.revisions)
        throw new Error('Duplicate a packaged reviewer before editing its instructions.');

    const revision = target.revisions.length + 1;

    target.revisions.push({ revision, text: instructions });
    target.instructions = { kind: 'revision', revision };

    return next;
}
