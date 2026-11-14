import { groupMembers } from './blocker-declarations.ts';
import { cites } from './review-dependencies.ts';
import type { WorkRecords } from './work-records.ts';

/** Exact text is checked in the explicitly referenced part's current brief, including Notes. */
export function staleAnswerQuotes(records: WorkRecords, groupId: string, answers: Record<string, string> = {}) {
    const members = groupMembers(records, groupId);
    const parts = members.filter((r) => r.kind === 'build' && !r.setAside);
    const stale: { workId: string; partId: string; quotes: string[] }[] = [];

    for (const decision of members.filter((r) => r.kind === 'decision' && !r.setAside)) {
        const answer = answers[decision.workId] ?? records.decisionAnswer(decision.workId).current?.text;

        if (!answer) continue;

        // A list entry or paragraph scopes its own part references; unrelated quotes never cross entries.
        const entries = answer.split(/\n\s*\n|\n(?=\s*[-*]\s)/);

        for (const part of parts) {
            const brief = records.body(part.workId, 'brief') ?? '';
            const quotes = entries
                .filter((entry) => cites(entry, part.workId, part.title))
                .flatMap((entry) =>
                    [
                        ...entry.matchAll(
                            /"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’|`([^`\n]+)`|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu,
                        ),
                    ]
                        .map((match) => match.slice(1).find(Boolean)!)
                        // IDs/titles identify the source, rather than quoting its product text.
                        .filter((quote) => quote !== part.workId && quote !== part.title && !brief.includes(quote)),
                );

            if (quotes.length)
                stale.push({ workId: decision.workId, partId: part.workId, quotes: [...new Set(quotes)] });
        }
    }

    return stale;
}
