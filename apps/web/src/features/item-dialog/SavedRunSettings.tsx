import type { SavedRunChoices } from '@lar-factory/shared';

import { DetailFact, FactList, MetaLine, Moment, SavedRunSection } from '@/ui/board';

const label = (value: string) =>
    value === 'ci-fixer' ? 'CI fixer' : value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
const unresolved = 'T3 default (not resolved)';

/** A thread's or a role's saved model, then its effort as a fact of its own. */
function Choice({ name, choice: { model, effort } }: { name: string; choice: SavedRunChoices['thread'] }) {
    return (
        <>
            <DetailFact label={name}>{model ? `${model.instanceId} / ${model.model}` : unresolved}</DetailFact>
            <DetailFact label={`${name} effort`}>{effort ?? unresolved}</DetailFact>
        </>
    );
}

/** Read-only snapshots: live Settings never replace the choices saved with a run. */
export function SavedRunSettings({ runs }: { runs: SavedRunChoices[] }) {
    return runs.map((run, index) => (
        <SavedRunSection key={run.runId} label={`${label(run.kind)} run ${index + 1}: saved choices`}>
            <FactList>
                <DetailFact label="Saved at">
                    <Moment at={run.capturedAt} />
                </DetailFact>
                <Choice name="Thread" choice={run.thread} />
                {run.roles.map((role) => (
                    <Choice
                        key={role.role}
                        name={
                            role.role.startsWith('reviewer:')
                                ? `${run.reviewers.find((r) => `reviewer:${r.id}` === role.role)?.name ?? role.role} reviewer`
                                : label(role.role)
                        }
                        choice={role}
                    />
                ))}
                {run.reviewers.map((reviewer) => (
                    <DetailFact key={reviewer.id} label={`${reviewer.name} instructions`}>
                        <MetaLine
                            parts={[
                                reviewer.instructions,
                                reviewer.mode === 'on-trigger' ? 'On trigger' : label(reviewer.mode),
                            ]}
                        />
                    </DetailFact>
                ))}
            </FactList>
        </SavedRunSection>
    ));
}
