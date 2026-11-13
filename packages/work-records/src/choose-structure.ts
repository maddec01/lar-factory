import type { BriefScope } from './brief-scope.ts';
import { WorkRecordError } from './database.ts';

/** A repeatable choice from the user's confirmed repositories and unsettled product decisions. */
export function chooseStructure(scope: BriefScope) {
    if (!scope.repositories?.length || !scope.openDecisions)
        throw new WorkRecordError(
            'invalid',
            'Confirmed scope needs repositories and openDecisions. Confirm an explicit amendment before choosing structure.',
        );

    const multiple = scope.repositories.length > 1;
    const structure = multiple ? (scope.openDecisions.length ? 'concept' : 'linked') : 'single';
    const reason =
        structure === 'concept'
            ? 'Several repositories and open product decisions: record decisions as concept parts.'
            : structure === 'linked'
              ? 'Scope is settled across several repositories: one parent, one build per repository, blockers by dependency.'
              : 'One repository: keep a single flow and settle its open questions during shaping.';

    return { structure, reason, repositories: scope.repositories, openDecisions: scope.openDecisions };
}
