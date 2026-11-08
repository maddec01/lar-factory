import { trackerCapabilities, type SetupDetection } from '@lar-factory/shared';
import { emptyVocabularyTerm } from '@lar-factory/shared/vocabulary';
import { Disclosure, HelpTip, InsetPanel, Text } from '@lar-works/design-system';

import { useWizardStore, type Run } from './WizardStore';
import {
    KIND_NAMES,
    useVocabularyDiscovery,
    VocabularyFields,
    VocabularyRead,
    type VocabularyKind,
} from '@/features/repositories';

function KindMappingFields({ run, detection }: { run: Run; detection: SetupDetection }) {
    const { choose, detect } = useWizardStore();
    const { discovery, error, retry } = useVocabularyDiscovery(run.repo!, true);

    if (!discovery) return <VocabularyRead repo={run.repo!} error={error} retry={retry} />;

    return (
        <InsetPanel presentation="settings">
            {(Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => (
                <VocabularyFields
                    key={key}
                    name={key}
                    setup={detection}
                    discovery={discovery}
                    value={run.choices.vocabulary?.[key] ?? emptyVocabularyTerm()}
                    newLabels={run.choices.newLabels?.[key] ?? []}
                    onRecheck={() => void detect()}
                    onChange={(value, names) => {
                        const newLabels: NonNullable<Run['choices']['newLabels']> = { ...run.choices.newLabels };

                        delete newLabels[key];

                        if (names.some((name) => name.trim())) newLabels[key] = names;

                        choose({
                            vocabulary: { ...run.choices.vocabulary, [key]: value },
                            newLabels: Object.keys(newLabels).length ? newLabels : undefined,
                        });
                    }}
                />
            ))}
        </InsetPanel>
    );
}

/** Folded and reading nothing until opened, unless a kept draft could be what holds Next back. */
export function KindMapping({ run, detection }: { run: Run; detection: SetupDetection }) {
    const labels = trackerCapabilities(detection.repo).heading.toLowerCase();

    return (
        <Disclosure
            data-kind-mapping=""
            presentation="group"
            label={`Map kinds to ${labels} and types`}
            badge="Optional"
            lazy
            defaultOpen={!!run.choices.vocabulary || !!run.choices.newLabels}
        >
            <Text variant="caption" tone="muted">
                New {labels} wait until you add the project.{' '}
                <HelpTip label="kind mapping">
                    Skip this if you like. Without a mapping, new tickets get no {labels} from their kind. New {labels}{' '}
                    are created only when you choose Save and add project. You can edit these mappings later in
                    Settings.
                </HelpTip>
            </Text>
            <KindMappingFields run={run} detection={detection} />
        </Disclosure>
    );
}
