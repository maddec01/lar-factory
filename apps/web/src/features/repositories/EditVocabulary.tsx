import { trackerCapabilities, type RepositorySetup } from '@lar-factory/shared';
import { InsetPanel, SettingsGroup, Stack } from '@lar-works/design-system';

import { useEditStore } from './EditStore';
import { useVocabularyDiscovery } from './useVocabularyDiscovery';
import { VocabularyFields, VocabularyRead } from './VocabularyEditor';
import { KIND_NAMES, type VocabularyKind } from './VocabularyKinds';

function VocabularySettings({ setup }: { setup: RepositorySetup }) {
    const { discovery, error, retry } = useVocabularyDiscovery(setup.repo);
    const { vocabulary, vocabularyDrafts, vocabularyErrors, draftVocabulary, recheck } = useEditStore();

    if (!discovery) return <VocabularyRead repo={setup.repo} error={error} retry={retry} />;

    return (
        <Stack space="related">
            {error && <VocabularyRead repo={setup.repo} error={error} retry={retry} />}
            <InsetPanel presentation="settings">
                {(Object.keys(KIND_NAMES) as VocabularyKind[]).map((key) => {
                    const draft = vocabularyDrafts[setup.repo]?.[key];

                    return (
                        <VocabularyFields
                            key={key}
                            name={key}
                            setup={setup}
                            discovery={discovery}
                            value={draft?.value ?? setup.vocabulary[key]}
                            newLabels={draft?.newLabels ?? []}
                            error={vocabularyErrors[setup.repo]?.[key]}
                            onChange={(value, newLabels) => draftVocabulary(setup.repo, key, value, newLabels)}
                            onRecheck={() => {
                                void recheck(setup.repo);
                            }}
                            onCommit={(value, newLabels) => {
                                void vocabulary(setup.repo, key, value, newLabels);
                            }}
                        />
                    );
                })}
            </InsetPanel>
        </Stack>
    );
}

export function EditVocabulary({ setup }: { setup: RepositorySetup }) {
    const heading = trackerCapabilities(setup.repo).heading.toLowerCase();

    return (
        <SettingsGroup
            panel={false}
            aria-label="Kind vocabulary"
            title={`Kinds and ${heading}`}
            help={`Map bugs, features and improvements to existing ${heading} and types. Suggestions are optional.`}
            helpLabel="kind mapping"
        >
            <VocabularySettings setup={setup} />
        </SettingsGroup>
    );
}
