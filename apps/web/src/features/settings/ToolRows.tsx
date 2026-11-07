// What Settings says of each command the board checks: its state, and what it does or how to fix its check.

import { GH_FLOOR, type CheckedTool, type ToolCheck } from '@lar-factory/shared';
import type { ComponentProps, ReactNode } from 'react';

import type { SettingsData } from './SettingsModel';
import { ToolState } from '@/shared/settings/SettingControls';

/**
 * A command's state: the version it printed, else OK, noting scopes gh couldn't read; the problem its check found; or
 * Not checked before the first check, in sample mode, and for an az no listed repository needs.
 * A `login` row says Signed in or Signed out instead, and Signed in beside a gh too old.
 */
function toolState(check: ToolCheck | undefined, login = false): ComponentProps<typeof ToolState> {
    if (!check) return { text: 'Not checked', tone: 'muted' };

    const older = (version: string) => `${version}, older than ${GH_FLOOR}`;

    switch (check.result) {
        case 'ok':
            return { text: `${login ? 'Signed in' : check.version || 'OK'}`, tone: 'success' };
        case 'logged-out':
            return { text: login ? 'Signed out' : 'Logged out', tone: 'warning' };
        case 'outdated':
            return { text: `${login ? 'Signed in, ' : ''}${older(check.version)}`, tone: 'warning' };
        case 'no-extension':
            return { text: 'No azure-devops extension', tone: 'warning' };
        case 'not-running':
            return { text: 'Not running', tone: 'warning' };
        case 'missing':
            return { text: 'Not found', tone: 'error' };
    }
}

/** The commands Diagnostics › Tools lists, with what each does; az follows, as it goes unchecked while no listed repository needs it. */
export const DIAGNOSED: [Exclude<CheckedTool, 'az'>, string][] = [
    ['gh', 'Reads GitHub repository issues and linked pull requests.'],
    ['t3', 'Starts the lar-shape threads in T3 Code.'],
    ['git', "lar-build's agents branch, commit and push with it."],
    ['jq', "lar-shape's scripts read gh's answers with it."],
    ['curl', "lar-shape's scripts tell the board to refresh with it."],
];

/** Whether the check leaves gh out, as no listed repository is on GitHub; Diagnostics then leaves gh out. */
export const ghSkipped = (data: SettingsData): boolean => !!data.toolProgress?.skipped.includes('gh');

/** Why az isn't checked, once the check leaves it out; else nothing. */
export function azSkipped(data: SettingsData): string {
    return data.toolProgress?.skipped.includes('az') ? ' Not checked: no listed Project uses Azure DevOps.' : '';
}

/** `name`'s state in `data`, Checking while its check runs with no result yet. */
export function stateOf(data: SettingsData, name: CheckedTool, login = false): ComponentProps<typeof ToolState> {
    const check = data.tools?.[name];

    if (!check && data.toolProgress?.checking.includes(name)) return { text: 'Checking', tone: 'muted' };

    return toolState(check, login);
}

/** What the command does, or why its check failed and how to fix it. */
export function toolDescription(does: string, check: ToolCheck | undefined): ReactNode {
    if (!check || check.result === 'ok') return does;

    if (check.result === 'not-running') return 'Open T3 Code.';

    const where = check.result === 'missing' && check.override ? `Nothing runnable at ${check.override}. ` : '';

    if (!('fix' in check)) return `${where}Install T3 Code.`;

    return (
        <>
            {where}Fix: <code className="whitespace-nowrap">{check.fix}</code>
        </>
    );
}
