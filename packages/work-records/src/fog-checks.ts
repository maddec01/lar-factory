import { conceptFog, parseConceptMap } from '@lar-factory/shared';
import type { ReconcileItem } from '@lar-factory/shared/group-reconciliation';

import type { WorkRecords } from './work-records.ts';

/** A leftover is a mechanical hold, not something an acknowledgement can dismiss. */
export function fogChecks(records: WorkRecords, id: string): Omit<ReconcileItem, 'digest'>[] {
    const group = records.read(id);

    if (group.kind !== 'concept') return [];

    const owners = [group, ...records.children(id)].map((r) => ({
        id: r.workId,
        kind: r.kind,
        decisionMethod: r.decisionMethod ?? undefined,
        complete: Boolean(r.setAside || records.completion(r.workId).complete),
        active: r.status === 'Shaping' && !r.needsYou,
        question: Boolean(r.needsYou),
    }));

    return conceptFog(parseConceptMap(records.body(id, 'map') ?? '').fog, owners).flatMap((fog, index) =>
        fog.routed
            ? []
            : [
                  {
                      kind: 'map' as const,
                      key: `fog:${id}:${index}`,
                      workId: id,
                      requiresFix: true,
                      changes: [fog.text],
                      summary: `Fog has no live owner/route. Settle factory details and remove resolved Fog, or record a decision or pending question route: ${fog.question}`,
                  },
              ],
    );
}
