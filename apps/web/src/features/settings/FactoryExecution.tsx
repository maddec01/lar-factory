import type { ExecutionOverride, FactoryModelGroup } from '@lar-factory/shared/factory-settings';

import { FactoryCellChoice, FactoryModelRow } from '@/ui/board';

/** Model and effort inherit separately. An unavailable saved choice is always visible. */
export function FactoryExecution({
    label,
    value,
    groups,
    inherited,
    onChange,
}: {
    label: string;
    value: ExecutionOverride;
    groups: FactoryModelGroup[];
    inherited: string;
    onChange: (value: ExecutionOverride) => void;
}) {
    const models = groups.flatMap((group) =>
        group.models.map((model) => ({
            value: JSON.stringify({ instanceId: group.instanceId, model: model.slug }),
            label: `${group.name} ${model.label}`,
        })),
    );
    const selected = value.model ? JSON.stringify(value.model) : 'inherit';
    const offered = groups
        .find((group) => group.instanceId === value.model?.instanceId)
        ?.models.find((model) => model.slug === value.model?.model);
    // Without a model override the eventual thread/project varies; offer only values T3 advertises somewhere.
    const efforts = value.model
        ? (offered?.efforts ?? [])
        : [
              ...new Map(
                  groups
                      .flatMap((group) => group.models.flatMap((model) => model.efforts ?? []))
                      .map((entry) => [entry.value, entry]),
              ).values(),
          ];

    return (
        <FactoryModelRow label={label}>
            <FactoryCellChoice
                label="Model"
                context={label}
                value={selected}
                options={[
                    { value: 'inherit', label: inherited },
                    ...models,
                    ...(value.model && !models.some((entry) => entry.value === selected)
                        ? [
                              {
                                  value: selected,
                                  label: `${value.model!.instanceId} ${value.model!.model} (not offered)`,
                                  disabled: true,
                              },
                          ]
                        : []),
                ]}
                onChange={(next) => {
                    const { model: _model, ...rest } = value;

                    onChange(
                        next !== 'inherit'
                            ? { ...rest, model: JSON.parse(next) as NonNullable<ExecutionOverride['model']> }
                            : rest,
                    );
                }}
            />
            <FactoryCellChoice
                label="Effort"
                context={label}
                value={value.effort ?? 'inherit'}
                options={[
                    { value: 'inherit', label: inherited },
                    ...efforts,
                    ...(value.effort && !efforts.some((entry) => entry.value === value.effort)
                        ? [{ value: value.effort, label: `${value.effort} (not offered)`, disabled: true }]
                        : []),
                ]}
                onChange={(next) => {
                    const { effort: _effort, ...rest } = value;

                    onChange(next !== 'inherit' ? { ...rest, effort: next } : rest);
                }}
            />
        </FactoryModelRow>
    );
}
