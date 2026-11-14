import { WorkRecordError } from './database.ts';

/** Agent-authored identities, notes and response references never prove a human action. */
export function requireHumanAction(action: string): never {
    throw new WorkRecordError(
        'invalid',
        `${action} requires Pedro's action in the board. Agent text is not approval. Ask Pedro to use the recorded board control, then stop. Never duplicate its wait with a generic Needs you notice.`,
    );
}
