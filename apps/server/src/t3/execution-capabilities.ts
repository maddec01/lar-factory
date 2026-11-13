import { isRecord } from '@lar-factory/shared';
import type { ExecutionModel } from '@lar-factory/shared/execution-target';

import { boardSessionAuthority } from './board-session.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimeOrigin } from './t3-settings.ts';

/** T3 nightly 2026-11-13: subscribeServerConfig snapshot, ServerProvider models/capabilities.optionDescriptors. */
export function executionModels(value: unknown): ExecutionModel[] {
    if (
        !isRecord(value) ||
        value.type !== 'snapshot' ||
        !isRecord(value.config) ||
        !Array.isArray(value.config.providers)
    )
        throw new Error('T3 did not report model capabilities.');

    return value.config.providers.flatMap((provider): ExecutionModel[] => {
        if (!isRecord(provider) || typeof provider.instanceId !== 'string' || !Array.isArray(provider.models))
            return [];

        const problem =
            provider.enabled !== true
                ? 'Provider is disabled.'
                : provider.installed !== true
                  ? 'Provider is not installed.'
                  : ['error', 'disabled'].includes(String(provider.status))
                    ? 'Provider is not ready.'
                    : provider.availability === 'unavailable'
                      ? 'Provider is unavailable.'
                      : isRecord(provider.auth) && provider.auth.status === 'unauthenticated'
                        ? 'Provider is not authenticated.'
                        : undefined;

        return provider.models.flatMap((model): ExecutionModel[] => {
            if (!isRecord(model) || typeof model.slug !== 'string') return [];

            const descriptors =
                isRecord(model.capabilities) && Array.isArray(model.capabilities.optionDescriptors)
                    ? model.capabilities.optionDescriptors
                    : [];

            return [
                {
                    instanceId: provider.instanceId as string,
                    model: model.slug,
                    ...(problem && { problem }),
                    options: descriptors.flatMap((option) => {
                        if (!isRecord(option) || typeof option.id !== 'string') return [];

                        return [
                            {
                                id: option.id,
                                values:
                                    option.type === 'boolean'
                                        ? [true, false]
                                        : Array.isArray(option.options)
                                          ? option.options.flatMap((entry) =>
                                                isRecord(entry) && typeof entry.id === 'string' ? [entry.id] : [],
                                            )
                                          : [],
                            },
                        ];
                    }),
                },
            ];
        });
    });
}

/** Read fresh capabilities through the existing local, read-only authorization boundary. */
async function readExecutionValue(tag: string, payload: Record<string, unknown>): Promise<unknown> {
    const authority = boardSessionAuthority();
    const session = await authority.issue();

    try {
        return await new Promise((resolve, reject) => {
            let stop: (() => void) | undefined;
            let finished = false;
            const finish = (value?: unknown, error?: Error) => {
                if (finished) return;

                finished = true;
                clearTimeout(timer);
                stop?.();

                if (error) reject(error);
                else resolve(value);
            };
            const timer = setTimeout(
                () => finish(undefined, new Error('T3 model capabilities timed out. Retry when T3 is available.')),
                10_000,
            );

            try {
                stop = subscribeProjects(
                    new URL(serverRuntimeOrigin()),
                    '',
                    {
                        subscriptionSession: async () => session,
                        invalidateSession() {},
                    },
                    () => finish(undefined, new Error('T3 model capabilities are unavailable.')),
                    {
                        tag,
                        payload,
                        accept: (value) => finish(value),
                        reject: () => finish(undefined, new Error('T3 refused the model capabilities request.')),
                    },
                );

                if (finished) stop();
            } catch {
                finish(undefined, new Error('Invalid local T3 capabilities endpoint.'));
            }
        });
    } finally {
        await authority.revoke(session.sessionId).catch(() => {});
    }
}

export async function readExecutionModels(): Promise<ExecutionModel[]> {
    return executionModels(await readExecutionValue('subscribeServerConfig', {}));
}

export function readExecutionProjection(threadId: string): Promise<unknown> {
    return readExecutionValue('orchestration.getThreadProjection', { threadId });
}
