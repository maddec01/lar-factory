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

/** Delivery facts belong to records. Legacy prose is read without those facts too. */
export function productContent(markdown: string): string {
    const structured = /^##\s+Product\s*$/im.test(markdown);
    let excludedAt = 0;
    let fence = '';
    const lines = markdown.split(/\r?\n/).filter((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

        if (marker && (!fence || marker[0] === fence[0])) fence = fence ? '' : marker;

        if (fence || marker) return !excludedAt;

        const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

        if (heading) {
            const level = heading[1]!.length;

            if (excludedAt && level <= excludedAt) excludedAt = 0;

            if (/^(?:(?:delivery\s+)?(?:status|progress)|history)(?:\s*\(.*\))?$/i.test(heading[2]!))
                excludedAt ||= level;
        }

        return !excludedAt;
    });

    // Compatibility for pre-split answers/maps. Match factual workflow sentences,
    // never requirements such as "A2 waits for A1" or "merge must preserve labels".
    const status =
        /^(?:[-*]\s*)?(?:(?:[A-Z]\d+|[A-Za-z][\w-]* build)\s+(?:is|has|remains)\s+(?:merged|Done|Ready(?: to merge)?|In progress|Shaping|Queued|pending)\b|(?:All|The)\s+(?:\w+\s+)?build briefs\s+(?:are Ready|have board approval)\b|Product implementation waits for a later Start build choice\b|The final Outcome check remains pending\b|Its recorded Node\b.*\bsuite passed\b)/;

    fence = '';

    const product: string[] = [];

    for (const line of lines) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];

        if (marker && (!fence || marker[0] === fence[0])) fence = fence ? '' : marker;

        if (fence || marker) {
            product.push(line);
            continue;
        }

        const text = line
            .split(/(?<=[.!?])\s+(?=[A-Z])|;\s+(?=[A-Z]\d+\s+is\s)/)
            .filter((sentence) => structured || !status.test(sentence.trim()))
            .join(' ')
            .replace(/(^\s*[-*]\s*Decision\s+[^,\n]+),\s*answer revision \d+(?=:)/gi, '$1, answer')
            .replace(/[ \t]+/g, ' ');

        if (text.trim() || product.at(-1)?.trim()) product.push(text);
    }

    return product.join('\n').trim();
}
