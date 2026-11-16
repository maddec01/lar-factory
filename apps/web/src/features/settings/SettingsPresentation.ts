// Sentences describing settings operations, separate from the store’s state transitions.
import type { UpdateChannel } from '@lar-factory/shared';

import type { SettingsResult } from './SettingsStore';

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function channelFailure(channel: UpdateChannel, error: unknown): SettingsResult {
    return { text: `Couldn’t switch to ${channel}: ${failure(error)}`, tone: 'danger' };
}
