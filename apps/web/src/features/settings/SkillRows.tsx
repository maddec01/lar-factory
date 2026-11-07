// Settings' Skills page: the folders the app installs its skills into, and who wrote each bundled skill.

import { blockedBy, clock, day, type BundledSkill, type TargetSnapshot } from '@lar-factory/shared';
import type { BlockingPath } from '@lar-factory/shared/install-skills';
import { Code, Inline, InlineLink, Link, Text } from '@lar-works/design-system';
import type { ComponentProps } from 'react';

import { TargetSwitch, TargetsNote } from './AppRows';
import { custom, type Group, type PagesInput, type Row } from './SettingsModel';
import { TargetProgress } from './TargetProgress';
import { TargetReaders } from './TargetReaders';
import { ToolState } from '@/shared/settings/SettingControls';

const ONLY_APP_TARGETS = 'Only the board app installs skills into agent folders.';

/** Why a target can't be unticked, or nothing. */
function lockedReason({ locked, instances }: TargetSnapshot): string | undefined {
    if (!locked) return undefined;

    return instances.length > 0
        ? "T3 Code's provider instances read it, so it stays ticked."
        : "Claude's skill links point here, so it stays ticked.";
}

/**
 * What a target's row says: for a selected target whose provider home doesn't exist, that it isn't installed until
 * the home does, since its switch shows off; otherwise why it can't be unticked, or nothing.
 */
function targetNote(target: TargetSnapshot): string | undefined {
    if (!target.homeMissing) return lockedReason(target);

    const home = target.path.replace(/\/skills$/, '');
    const why = target.instances.length > 0 ? "T3 Code's provider instances read it; " : '';

    return `Not installed until ${home} exists. ${why}Lar Factory installs here once it exists.`;
}

export function targetGroup({ app, targets }: PagesInput): Group {
    const description = 'The app installs its skills into each ticked folder: copies, or links in a Claude home.';

    if (!app)
        return {
            title: 'Skill folders',
            rows: [],
            note: (
                <Text variant="caption" tone="muted">
                    {ONLY_APP_TARGETS}
                </Text>
            ),
        };

    return {
        title: 'Skill folders',
        help: description,
        note: <TargetsNote />,
        rows: (targets ?? []).map((target) => ({
            id: `target-${target.path}`,
            title: target.path,
            description: targetNote(target),
            control: custom(() => <TargetSwitch path={target.path} reason={targetNote(target)} />),
            below: (
                <>
                    <TargetReaders target={target} />
                    <TargetProgress target={target} />
                </>
            ),
        })),
    };
}

/** A skill's install state, with what it means as its tooltip; nothing before an install records it. */
function InstallState({ status }: { status: BundledSkill['status'] }) {
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
function BlockedReason({ status }: { status: BundledSkill['status'] }) {
    if (status?.state !== 'blocked') return null;

    const [opening, ...rest] = blockedBy(status.paths, (path) => (
        <Code key={path} wrap="anywhere">
            {path}
        </Code>
    ));

    return (
        <Text variant="caption" tone="danger" data-blocked-reason>
            {capitalise(opening)}
            {rest}. {moveAway(status.paths)}
        </Text>
    );
}

/**
 * Who wrote each skill and checklist the app bundles, under which licence, its last update, its install state and a
 * link to its source. A Copy's last update is its Date in UPSTREAM.md; Lar's own skills update with the app.
 */
export function bundledGroup({ data, version }: PagesInput): Group {
    const skills = data.bundledSkills ?? [];
    // A Date is a day with no time zone, so it reads the same everywhere. Neither a date nor a version breaks across lines.
    const updated = (skill: BundledSkill) =>
        skill.date ? (
            <>
                {' '}
                ·{' '}
                <Text as="span" variant="inherit" nowrap>
                    updated {day(skill.date, 'UTC')}
                </Text>
            </>
        ) : skill.author === 'Lar' && version ? (
            <>
                {' '}
                ·{' '}
                <Text as="span" variant="inherit" nowrap>
                    updated in Lar Factory {version}
                </Text>
            </>
        ) : null;
    const rows: Row[] = skills.length
        ? skills.map((skill) => ({
              id: `bundled-${skill.name}`,
              title: skill.name,
              description: (
                  <>
                      {skill.author} · {skill.licence}
                      {updated(skill)}
                      {skill.includedAuthors?.length ? (
                          <Text variant="caption" tone="muted">
                              Includes work by {skill.includedAuthors.join(', ')}.{' '}
                              {skill.notices ? (
                                  <InlineLink href={skill.notices}>THIRD_PARTY_NOTICES.md</InlineLink>
                              ) : (
                                  'THIRD_PARTY_NOTICES.md'
                              )}
                          </Text>
                      ) : null}
                      <BlockedReason status={skill.status} />
                  </>
              ),
              control: custom(() => (
                  <Inline as="span" space="related" align="center">
                      <InstallState status={skill.status} />
                      <Link variant="caption" external aria-label={`${skill.name} source`} href={skill.source}>
                          Source
                      </Link>
                  </Inline>
              )),
          }))
        : [
              {
                  id: 'bundled-unread',
                  title: "Couldn't read the bundled skills",
                  noteOnly: true,
                  description: "The board server couldn't read the app's bundle, so it can't credit them here.",
                  control: custom(() => null),
              },
          ];

    return { title: 'Bundled skills', help: 'The skills and checklists the app installs, and who wrote them.', rows };
}
