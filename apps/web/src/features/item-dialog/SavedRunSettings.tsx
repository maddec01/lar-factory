import type { SavedRunChoices } from '@lar-factory/shared';

import { DetailFact, FactList, SavedRunSection } from '@/ui/board';

const label = (value: string) =>
    value === 'ci-fixer' ? 'CI fixer' : value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');
const choice = ({ model, effort }: SavedRunChoices['thread']) =>
    `${model ? `${model.instanceId} / ${model.model}` : 'T3 default (not resolved)'} · ${effort ? `Effort: ${effort}` : 'Effort: T3 default (not resolved)'}`;

/** Read-only snapshots: live Settings never replace the choices saved with a run. */
export function SavedRunSettings({ runs }: { runs: SavedRunChoices[] }) {
    return runs.map((run, index) => (
        <SavedRunSection key={run.runId} label={`${label(run.kind)} run ${index + 1}: saved choices`}>
            <FactList>
                <DetailFact label="Saved at">{new Date(run.capturedAt).toLocaleString()}</DetailFact>
                <DetailFact label="Thread">{choice(run.thread)}</DetailFact>
                {run.roles.map((role) => (
                    <DetailFact
                        key={role.role}
                        label={
                            role.role.startsWith('reviewer:')
                                ? `${run.reviewers.find((r) => `reviewer:${r.id}` === role.role)?.name ?? role.role} reviewer`
                                : label(role.role)
                        }
                    >
                        {choice(role)}
                    </DetailFact>
                ))}
                {run.reviewers.map((reviewer) => (
                    <DetailFact key={reviewer.id} label={`${reviewer.name} instructions`}>
                        {reviewer.instructions} · {reviewer.mode === 'on-trigger' ? 'On trigger' : label(reviewer.mode)}
                    </DetailFact>
                ))}
            </FactList>
        </SavedRunSection>
    ));
}
