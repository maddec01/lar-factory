import { dependencyStatusText, type Item } from '@lar-factory/shared';

import { BriefDependencyStatus } from '@/ui/board';

/** Live facts beside retained approval content; never rewrite a brief for delivery progress. */
export function DependencyStatus({ item }: { item: Item }) {
    const dependencies = item.blockers.flatMap((blocker) => (blocker.dependency ? [blocker.dependency] : []));

    return dependencies.length ? (
        <BriefDependencyStatus
            rows={dependencies.map((d) => ({ id: d.dependencyId, text: dependencyStatusText(d) }))}
        />
    ) : null;
}
