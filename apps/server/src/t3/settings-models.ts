import { isRecord, type ModelGroup } from '@lar-factory/shared';
import type { FactoryModelGroup } from '@lar-factory/shared/factory-settings';

import { modelEfforts } from './model-efforts.ts';
import { subscribeProjects } from './project-subscription.ts';
import { repositoryProjectAccess } from './repository-project-discovery.ts';

/** T3's ServerProviderModel.capabilities.optionDescriptors, never provider settings or secrets. */
export function settingsModelChoices(groups: ModelGroup[], config: unknown): FactoryModelGroup[] {
    const providers = isRecord(config) && Array.isArray(config.providers) ? config.providers.filter(isRecord) : [];

    return groups.map((group) => {
        const provider = providers.find((entry) => entry.instanceId === group.instanceId);
        const models = Array.isArray(provider?.models) ? provider.models.filter(isRecord) : [];

        return {
            ...group,
            models: group.models.map((model) => {
                const offered = models.find((entry) => entry.slug === model.slug);

                // Runtime capabilities are authoritative when the model is reported.
                return offered ? { ...model, efforts: modelEfforts(offered.capabilities) } : model;
            }),
        };
    });
}

/** Uses the board's existing read session; failure leaves inheritance and saved choices visible. */
export async function readSettingsModels(groups: ModelGroup[]): Promise<FactoryModelGroup[]> {
    const access = repositoryProjectAccess();

    if (!access) return groups;

    return new Promise((resolve) => {
        let stop: (() => void) | undefined;
        const finish = (value?: unknown) => {
            clearTimeout(timer);
            stop?.();
            resolve(settingsModelChoices(groups, value));
        };
        const timer = setTimeout(() => finish(), 15_000);

        try {
            stop = subscribeProjects(
                access.origin,
                '',
                {
                    subscriptionSession: () => access.protocol.subscriptionSession(),
                    invalidateSession() {},
                },
                () => {},
                { tag: 'server.getConfig', payload: {}, accept: finish, reject: () => finish() },
            );
        } catch {
            finish();
        }
    });
}
