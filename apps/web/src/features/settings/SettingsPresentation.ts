// Sentences describing settings operations, separate from the store’s state transitions.
import type { InstallOperationResult, TargetSnapshot, UpdateChannel } from '@lar-factory/shared';

import type { SettingsResult } from './SettingsStore';

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function targetFailure(action: string, error: unknown): SettingsResult {
    return { text: `Couldn’t ${action}: ${failure(error)}`, tone: 'danger', from: 'targets' };
}

export function channelFailure(channel: UpdateChannel, error: unknown): SettingsResult {
    return { text: `Couldn’t switch to ${channel}: ${failure(error)}`, tone: 'danger', from: 'updates' };
}

/** What an untick removed, in words. */
function untickText(
    target: TargetSnapshot | undefined,
    where: string,
    removed: InstallOperationResult['removed'],
): string {
    if (target?.kind !== 'claude') return `Lar Factory no longer installs into ${where}, and left its copies there.`;

    const links = (removed?.links.length ?? 0) > 0;
    const checklists = removed?.checklists ?? false;

    if (links && checklists) return `Removed the skill links and checklists from ${where}.`;

    if (links) return `Removed the skill links from ${where}.`;

    if (checklists) return `Removed the checklists from ${where}.`;

    return `Lar Factory had no skill links or checklists in ${where} to remove.`;
}

export function targetResult({
    target,
    path,
    ticked,
    conflicts,
    removed,
    error,
}: {
    target: TargetSnapshot | undefined;
    path: string;
    ticked: boolean;
    conflicts: string[];
    removed: InstallOperationResult['removed'];
    error: string | undefined;
}): SettingsResult {
    if (error) return targetFailure(`change ${path}`, error);

    if (conflicts.length)
        return {
            text: `${ticked ? `Installed into ${path}, but` : `${untickText(target, path, removed)} It`} left these alone because Lar Factory didn’t make them:`,
            tone: 'warning',
            paths: conflicts,
            from: 'targets',
        };

    return {
        text: ticked ? `Installed the skills into ${path}.` : untickText(target, path, removed),
        tone: 'success',
        from: 'targets',
    };
}
