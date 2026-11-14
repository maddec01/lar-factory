import { mapContractReferences } from './contract-references.ts';
import type { WorkRecords } from './work-records.ts';

/** Legacy Parts prose is historical input only. Every current part state comes from the same records snapshot. */
export function projectMapParts(records: WorkRecords, groupId: string, markdown: string): string {
    const parts = records.children(groupId).filter((r) => r.kind !== 'slice');

    if (!parts.length || !/^##\s/m.test(markdown)) return markdown;

    const consumption = mapContractReferences(records, markdown);

    const generated = `## Parts\n${parts
        .map((r) => {
            const gate = records.gate(r.workId);
            const spec = records.specState(r.workId);
            const disposition = r.supersededBy
                ? `Merged into ${records.read(r.supersededBy).title}`
                : r.setAside
                  ? 'Set aside'
                  : r.status;
            const state =
                r.kind === 'decision'
                    ? records.decisionAnswer(r.workId).current
                        ? 'answered'
                        : 'unanswered'
                    : `gate: ${gate.current ? 'current' : 'awaiting approval'}; Spec: ${spec.held ? 'held edit' : spec.error ? 'sync failed' : spec.pending !== null ? 'pending' : !spec.active ? 'not published' : gate.current ? 'current' : 'out of date'}; phase: ${r.buildPhase ?? 'none'}`;

            return `- [${r.kind}: ${r.workId}] ${r.title} — ${disposition}; ${state}${
                consumption.get(r.workId)?.length
                    ? `; Consumes: ${consumption
                          .get(r.workId)!
                          .map((id) => `\`${id}\``)
                          .join(', ')}`
                    : ''
            }`;
        })
        .join('\n')}\n\n`;

    return /^##\s+Parts\s*$/im.test(markdown)
        ? markdown.replace(/^##\s+Parts\s*\n[\s\S]*?(?=^##\s|$(?![\s\S]))/gim, generated)
        : `${markdown.trimEnd()}\n\n${generated.trimEnd()}`;
}
