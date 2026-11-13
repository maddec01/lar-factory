// A simulation can freeze its launch and delegation default without changing the user's T3 settings.
import { isRecord, type ModelSelection } from '@lar-factory/shared';

/** Explicit development-only model selection; invalid input never falls back to the installed app's defaults. */
export function developmentModel(env: NodeJS.ProcessEnv = process.env): ModelSelection | undefined {
    const raw = env.BOARD_DEV_MODEL_SELECTION;

    if (raw === undefined) return undefined;

    if (env.NODE_ENV !== 'development') throw new Error('BOARD_DEV_MODEL_SELECTION requires NODE_ENV=development.');

    const value: unknown = JSON.parse(raw);

    if (
        !isRecord(value) ||
        typeof value.instanceId !== 'string' ||
        !value.instanceId ||
        typeof value.model !== 'string' ||
        !value.model ||
        (value.options !== undefined &&
            (!Array.isArray(value.options) ||
                value.options.some(
                    (option) =>
                        !isRecord(option) ||
                        typeof option.id !== 'string' ||
                        !['string', 'boolean'].includes(typeof option.value),
                )))
    )
        throw new Error('BOARD_DEV_MODEL_SELECTION needs an instanceId, model and optional id/value options.');

    return value as unknown as ModelSelection;
}
