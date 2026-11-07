import {
    repositoryT3Default,
    shownRepo,
    t3DefaultDetail,
    type BoardData,
    type ModelChoice,
    type ModelGroup,
} from '@lar-factory/shared';
import { Button, DropdownMenu } from '@lar-works/design-system';
// Settings uses the same provider groups and keyboard navigation as Start, with its saved model checked, and names the model each repository's builds use on T3 Project default.
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { ModelEntries, opensOnChecked } from '@/features/items/ModelEntries';
import { postAction, receive } from '@/services/board/board.service';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

function modelLabel(groups: ModelGroup[], selected: ModelChoice | undefined): string {
    if (!selected) return 'T3 Project default';

    const group = groups.find((g) => g.instanceId === selected.instanceId);
    const model = group?.models.find((m) => m.slug === selected.model);

    return model ? `${group!.name} ${model.label}` : `${selected.instanceId} ${selected.model} (not offered)`;
}

type AutoBuildData = Pick<BoardData, 'repos' | 'autoBuild' | 'modelChoices' | 't3Defaults'>;

/** Each repository's default model, once the board has read the setting and T3's defaults, which it never does in sample mode. */
function RepositoryDefaults({ data }: { data: AutoBuildData }) {
    if (!data.autoBuild || data.autoBuild.model || !data.t3Defaults || !data.repos.length) return null;

    return (
        <ul className="m-0 grid list-none gap-1 p-0 text-xs" aria-label="Default model by Project">
            {data.repos.map(({ repo }) => (
                <li key={repo} className="flex flex-wrap justify-between gap-x-3">
                    <span className="[overflow-wrap:anywhere]">{shownRepo(repo)}</span>{' '}
                    <span className="[overflow-wrap:anywhere] text-(--muted-foreground)">
                        {t3DefaultDetail(data.modelChoices, repositoryT3Default(data, repo)) ?? 'Default model unknown'}
                    </span>
                </li>
            ))}
        </ul>
    );
}

/** Disabled until the board has read the setting, which it never does in sample mode. */
export function AutoBuildModelSetting({ data }: { data: AutoBuildData }) {
    const { autoBuild: state, modelChoices: groups } = data;
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = async (model: ModelChoice | undefined) => {
        flushSync(() => {
            setOpen(false);
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
        <div className="grid gap-3" data-auto-build-model>
            <div className="grid max-w-80 gap-2">
                <DropdownMenu open={open && !saving} onOpenChange={(next) => setOpen(next && !saving)} modal={false}>
                    <DropdownMenu.Trigger asChild>
                        <Button
                            {...kind('other')}
                            aria-label="Auto-build model"
                            disabled={!state}
                            aria-busy={saving || undefined}
                            aria-disabled={saving || undefined}
                            className="max-w-full"
                        >
                            <span className="truncate">{saving ? 'Saving…' : modelLabel(groups, state?.model)}</span> ▾
                        </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" aria-label="Auto-build model" {...opensOnChecked}>
                        <ModelEntries
                            groups={groups}
                            selected={state?.model}
                            heading="Build with"
                            onPick={(model) => void save(model)}
                        />
                    </DropdownMenu.Content>
                </DropdownMenu>
                {error && (
                    <p className="m-0 text-xs text-(--error-foreground)" role="alert">
                        {error}
                    </p>
                )}
            </div>
            <RepositoryDefaults data={data} />
        </div>
    );
}
