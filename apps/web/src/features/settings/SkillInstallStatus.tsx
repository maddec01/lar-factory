// A bundled skill's install status and blocked reason, with the paths or profile choices that would clear it.

import { blockedBy, clock, day, type BundledSkill } from '@lar-factory/shared';
import type { BlockingPath } from '@lar-factory/shared/install-skills';
import { Alert, Code } from '@lar-works/design-system';
import type { ComponentProps } from 'react';

import { ToolState } from '@/shared/settings/SettingControls';

/** A skill's install state, with what it means as its tooltip; nothing before an install records it. */
export function InstallState({ status }: { status: BundledSkill['status'] }) {
    if (!status) return null;

    const [text, tone, title]: [string, ComponentProps<typeof ToolState>['tone'], string] =
        status.state === 'matching'
            ? ['Installed', 'success', 'Matches this version of Lar Factory.']
            : status.state === 'restored'
              ? [
                    `Restored ${day(status.restoredAt, undefined)}, ${clock(status.restoredAt, undefined)}`,
                    'warning',
                    'Lar Factory put back its copy, which had changed.',
                ]
              : ['Blocked', 'error', `${capitalise(blockedBy(status.paths).join(''))}. ${moveAway(status.paths)}`];

    return (
        <span title={title}>
            <ToolState text={text} tone={tone} />
        </span>
    );
}

/**
 * What clears a blocked skill, the end of its tooltip and line: moving the paths away, which installs the skill when
 * one is in ~/.agents/skills, or, when every path is in a Claude profile, unticking the profile.
 */
function moveAway(paths: readonly BlockingPath[]): string {
    const move = `Move ${paths.length === 1 ? 'that path' : 'each path'} away`;

    if (paths.some((blocking) => blocking.place === 'agents')) return `${move} to install this skill.`;

    const profiles = new Set(paths.flatMap((blocking) => (blocking.place === 'profile' ? [blocking.profile] : [])));

    return paths.every((blocking) => blocking.place === 'profile')
        ? `${move}, or untick the ${profiles.size === 1 ? 'profile' : 'profiles'}.`
        : `${move}.`;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What blocks a skill, where it leaves the skill missing and what to do, as a line under its credit; nothing for a skill nothing blocks. */
export function BlockedReason({ status }: { status: BundledSkill['status'] }) {
    if (status?.state !== 'blocked') return null;

    const [opening, ...rest] = blockedBy(status.paths, (path) => (
        <Code key={path} wrap="anywhere">
            {path}
        </Code>
    ));

    return (
        <Alert size="sm" tone="danger" data-blocked-reason>
            {capitalise(opening)}
            {rest}. {moveAway(status.paths)}
        </Alert>
    );
}
