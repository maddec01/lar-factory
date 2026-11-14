import { WorkRecordError } from './database.ts';

/** Reject copied launch contracts before any body/history/digest changes, including legacy unmarked prompts. */
export function assertProductContent(markdown: string): void {
    const exports = new Set(
        [...markdown.matchAll(/^\s*export\s+(LAR_FACTORY_(?:DATA_DIR|BIN|SHAPE_SKILL|BUILD_SKILL))=/gm)].map(
            (m) => m[1],
        ),
    );

    if (
        /<!-- factory-runtime(?::start|:end)? -->/i.test(markdown) ||
        /^\s*(?:Factory skill entries:|Frozen (?:role settings|project skills):|Factory run contract:|Run settings \(pass this exact block)/im.test(
            markdown,
        ) ||
        exports.size > 1 ||
        markdown.includes('Use the factory installation and data folder below for this thread and every subagent.')
    )
        throw new WorkRecordError(
            'invalid',
            'Records hold product content; remove the factory launch/handoff block. Read execution choices from run-settings records and keep runtime instructions in thread handoffs.',
        );
}
