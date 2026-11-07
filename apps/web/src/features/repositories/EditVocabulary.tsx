import { trackerCapabilities, type RepositorySetup } from '@lar-factory/shared';
import { HelpTip, InsetPanel } from '@lar-works/design-system';

import { useEditStore } from './EditStore';
import { useVocabularyDiscovery } from './useVocabularyDiscovery';
import { VocabularyFields, VocabularyRead } from './VocabularyEditor';
import { KIND_NAMES, type VocabularyKind } from './VocabularyKinds';

function VocabularySettings({ setup }: { setup: RepositorySetup }) {
    const { discovery, error, retry } = useVocabularyDiscovery(setup.repo);
    const { vocabulary, vocabularyDrafts, vocabularyErrors, draftVocabulary, recheck } = useEditStore();

    if (!discovery) return <VocabularyRead repo={setup.repo} error={error} retry={retry} />;

    return (
        <div className="grid min-w-0 gap-2">
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
        </div>
    );
}

export function EditVocabulary({ setup }: { setup: RepositorySetup }) {
    return (
        <section className="grid min-w-0 gap-3" aria-label="Kind vocabulary">
            <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">
                Kinds and {trackerCapabilities(setup.repo).heading.toLowerCase()}
                <HelpTip label="kind mapping">
                    Map bugs, features and improvements to existing{' '}
                    {trackerCapabilities(setup.repo).heading.toLowerCase()} and types. Suggestions are optional.
                </HelpTip>
            </h3>
            <VocabularySettings setup={setup} />
        </section>
    );
}
