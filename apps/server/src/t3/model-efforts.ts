import { isRecord } from '@lar-factory/shared';

/** T3 select descriptors only; option IDs and labels are the entire public surface. */
export function modelEfforts(capabilities: unknown): { value: string; label: string }[] {
    const descriptors =
        isRecord(capabilities) && Array.isArray(capabilities.optionDescriptors)
            ? capabilities.optionDescriptors.filter(isRecord)
            : [];
    const effort = descriptors.find(
        (entry) => ['reasoningEffort', 'effort'].includes(String(entry.id)) && entry.type === 'select',
    );
    const options = Array.isArray(effort?.options) ? effort.options.filter(isRecord) : [];

    return options.flatMap((option) =>
        typeof option.id === 'string' && typeof option.label === 'string'
            ? [{ value: option.id, label: option.label }]
            : [],
    );
}

/** A manifest model may inherit descriptors from its named profile, or replace them explicitly. */
export function manifestEfforts(provider: unknown, model: unknown) {
    if (!isRecord(provider) || !isRecord(model)) return [];

    const profile =
        isRecord(provider.profiles) && typeof model.profile === 'string' ? provider.profiles[model.profile] : undefined;

    return modelEfforts(model.capabilities ?? (isRecord(profile) ? profile.capabilities : undefined));
}
