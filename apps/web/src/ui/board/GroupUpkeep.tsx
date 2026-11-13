import { plural } from '@lar-factory/shared';
import type { ReconcileItem, ReconcileReport } from '@lar-factory/shared/group-reconciliation';
import { Disclosure, Stack } from '@lar-works/design-system';

function category(item: ReconcileItem): [string, string] {
    if (item.key.startsWith('doubt:')) return ['brief', 'to re-check: answers or sibling contracts changed'];

    const labels: Record<ReconcileItem['kind'], [string, string]> = {
        brief: ['brief', 'to update'],
        map: ['map entry', 'to update'],
        gate: ['approval', 'to renew'],
        overlap: ['overlap', 'to order'],
        blocker: ['blocker', 'to update'],
        ticket: ['ticket', 'to sync'],
        dependency: ['dependency', 'to re-check'],
        release: ['release step', 'to re-check'],
    };

    return labels[item.kind];
}

/** Pedro sees affected work grouped by the next action; agent instructions stay in the thread checklist. */
export function GroupUpkeep({ report, name }: { report?: ReconcileReport; name: (id: string) => string }) {
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
        <Stack space="tight" data-reconciliation>
            {[...groups].map(([key, group]) => (
                <Disclosure key={key} label={group.label} presentation="section">
                    <ul className="m-0 grid gap-1 pl-5 text-sm wrap-anywhere">
                        {[...group.names].map(([id, title]) => (
                            <li key={id}>{title}</li>
                        ))}
                    </ul>
                </Disclosure>
            ))}
        </Stack>
    );
}
