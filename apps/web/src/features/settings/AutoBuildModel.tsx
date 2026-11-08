import {
    repositoryT3Default,
    shownRepo,
    t3DefaultDetail,
    type BoardData,
    type ModelChoice,
    type ModelGroup,
} from '@lar-factory/shared';
import { Alert, OptionSelect, Stack } from '@lar-works/design-system';
// Settings uses the same provider groups and keyboard navigation as Start, with its saved model checked, and names the model each repository's builds use on Project default in T3.
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { postAction, receive } from '@/services/board/board.service';
import { ProjectValueList, SettingControl } from '@/ui/board';

function modelLabel(groups: ModelGroup[], selected: ModelChoice | undefined): string {
    if (!selected) return 'Project default in T3';

    const group = groups.find((g) => g.instanceId === selected.instanceId);
    const model = group?.models.find((m) => m.slug === selected.model);

    return model ? `${group!.name} ${model.label}` : `${selected.instanceId} ${selected.model} (not offered)`;
}

type AutoBuildData = Pick<BoardData, 'repos' | 'autoBuild' | 'modelChoices' | 't3Defaults'>;

/** Each repository's default model, once the board has read the setting and T3's defaults, which it never does in sample mode. */
function RepositoryDefaults({ data }: { data: AutoBuildData }) {
    if (!data.autoBuild || data.autoBuild.model || !data.t3Defaults || !data.repos.length) return null;

    return (
        <ProjectValueList
            label="Default model by Project"
            rows={data.repos.map(({ repo }) => ({
                key: repo,
                name: shownRepo(repo),
                value: t3DefaultDetail(data.modelChoices, repositoryT3Default(data, repo)) ?? 'Default model unknown',
            }))}
        />
    );
}

/** Disabled until the board has read the setting, which it never does in sample mode. */
export function AutoBuildModelSetting({ data }: { data: AutoBuildData }) {
    const { autoBuild: state, modelChoices: groups } = data;
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async (model: ModelChoice | undefined) => {
        flushSync(() => {
            setSaving(true);
            setError(null);
        });

        const result = await postAction('/api/auto-build', { model: model ?? null });

        flushSync(() => {
            receive(result);
            setSaving(false);
            setError(result.error);
        });
    };

    return (
        <Stack space="group" data-auto-build-model>
            <SettingControl>
                <OptionSelect
                    label="Auto-build model"
                    presentation="setting"
                    writesOnPick
                    disabled={!state}
                    busy={saving}
                    aria-busy={saving || undefined}
                    value={
                        state?.model
                            ? JSON.stringify({ instanceId: state.model.instanceId, model: state.model.model })
                            : 'default'
                    }
                    options={[
                        { value: 'default', label: 'Project default in T3' },
                        ...groups.flatMap((group) =>
                            group.models.map((model) => ({
                                value: JSON.stringify({ instanceId: group.instanceId, model: model.slug }),
                                label: `${group.name} ${model.label}`,
                            })),
                        ),
                        ...(state?.model &&
                        !groups.some(
                            (group) =>
                                group.instanceId === state.model?.instanceId &&
                                group.models.some((model) => model.slug === state.model?.model),
                        )
                            ? [
                                  {
                                      value: JSON.stringify({
                                          instanceId: state.model.instanceId,
                                          model: state.model.model,
                                      }),
                                      label: modelLabel(groups, state.model),
                                      disabled: true,
                                  },
                              ]
                            : []),
                    ]}
                    onChange={(value) =>
                        void save(value === 'default' ? undefined : (JSON.parse(value) as ModelChoice))
                    }
                />
                {error && (
                    <Alert size="sm" tone="danger">
                        {error}
                    </Alert>
                )}
            </SettingControl>
            <RepositoryDefaults data={data} />
        </Stack>
    );
}
