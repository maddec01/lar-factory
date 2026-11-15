import type { FactorySettings, FactorySettingsState } from '@lar-factory/shared/factory-settings';

import { postAction } from '@/services/board/board.service';

/** Why the settings couldn't be read when the server says no more. */
export const unreadable = 'Couldn’t load reviewer and model settings.';

export async function readFactorySettings(): Promise<FactorySettingsState> {
    const response = await fetch('/api/factory-settings', { cache: 'no-store' });

    if (!response.ok) throw new Error(unreadable);

    return response.json() as Promise<FactorySettingsState>;
}

export async function saveFactorySettings(settings: FactorySettings, revision: string) {
    const result = await postAction<Pick<FactorySettingsState, 'settings' | 'revision'>>('/api/factory-settings', {
        settings,
        revision,
    });

    if (result.error || !result.settings || !result.revision)
        throw new Error(result.error ?? 'Couldn’t confirm the saved settings.');

    return { settings: result.settings, revision: result.revision };
}
