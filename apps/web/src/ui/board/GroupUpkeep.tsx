import { plural } from '@lar-factory/shared';
import type { ReconcileItem, ReconcileReport } from '@lar-factory/shared/group-reconciliation';
import { Disclosure, Stack, Text } from '@lar-works/design-system';

function category(item: ReconcileItem): [string, string] {
    if (item.key.startsWith('doubt:')) return ['brief', 'to re-check after changed answers'];

    const labels: Record<ReconcileItem['kind'], [string, string]> = {
        brief: ['brief', 'to update'],
        map: ['map entry', 'to update'],
        gate: ['approval', 'to renew'],
        blocker: ['blocker', 'to update'],
        ticket: ['ticket', 'to sync'],
        dependency: ['dependency', 'to re-check'],
        release: ['release step', 'to re-check'],
    };

    return labels[item.kind];
}

/** "Concept map needs updating · 25 parts and 3 other records affected": the current parts it touches, then the rest
 *  (the concept itself, set-aside and retired work), so the count agrees with the row's parts count. */
function upkeepLabel(report: ReconcileReport, parts?: readonly string[]): string {
    const ids = new Set(report.items.map((item) => item.workId));

    if (!parts) return `Concept map needs updating · ${plural(ids.size, 'record')} affected`;

    const current = [...ids].filter((id) => parts.includes(id)).length;
    const other = ids.size - current;

    return `Concept map needs updating · ${[current && plural(current, 'part'), other && plural(other, 'other record')]
        .filter(Boolean)
        .join(' and ')} affected`;
}

/** One quiet line for the plan's upkeep: how many parts it touches, then, opened, the parts grouped by what they need.
 *  Agent instructions stay in the thread checklist. */
export function GroupUpkeep({
    report,
    name,
    parts,
}: {
    report?: ReconcileReport;
    name: (id: string) => string;
    /** The concept's current parts, so the count says how many of them it touches and how many other records. */
    parts?: readonly string[];
}) {
    if (!report?.items.length) return null;

    const groups = new Map<string, { label: string; names: Map<string, string> }>();

    for (const item of report.items) {
        const [noun, action] = category(item);
        const key = `${noun}:${action}`;
        const group = groups.get(key) ?? { label: '', names: new Map<string, string>() };

        group.names.set(item.workId, name(item.workId));
        group.label = `${plural(group.names.size, noun, noun === 'map entry' ? 'map entries' : noun === 'dependency' ? 'dependencies' : undefined)} ${action}`;
        groups.set(key, group);
    }

    return (
        <Disclosure label={upkeepLabel(report, parts)} presentation="section" data-reconciliation="">
            <Stack space="tight">
                {[...groups].map(([key, group]) => (
                    <div key={key} className="grid gap-1">
                        <Text variant="caption" tone="muted">
                            {group.label}
                        </Text>
                        <ul className="m-0 grid list-disc gap-1 pl-4 text-sm wrap-anywhere">
                            {[...group.names].map(([id, title]) => (
                                <li key={id}>{title}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </Stack>
        </Disclosure>
    );
}
