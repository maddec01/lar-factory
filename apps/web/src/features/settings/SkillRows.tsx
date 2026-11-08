import { day, type BundledSkill, type TargetSnapshot } from '@lar-factory/shared';
// Settings' Skills page: the folders the app installs its skills into, and who wrote each bundled skill.
import { Inline, InlineLink, Link, Text } from '@lar-works/design-system';

import { TargetSwitch, TargetsNote } from './AppRows';
import { custom, type Group, type PagesInput, type Row } from './SettingsModel';
import { BlockedReason, InstallState } from './SkillInstallStatus';
import { TargetProgress } from './TargetProgress';
import { TargetReaders } from './TargetReaders';

/** Why a target can't be unticked, or nothing. */
function lockedReason({ locked, instances }: TargetSnapshot): string | undefined {
    if (!locked) return undefined;

    return instances.length > 0
        ? 'T3 Code’s provider instances read it, so it stays ticked.'
        : 'Claude’s skill links point here, so it stays ticked.';
}

/**
 * What a target's row says: for a selected target whose provider home doesn't exist, that it isn't installed until
 * the home does, since its switch shows off; otherwise why it can't be unticked, or nothing.
 */
function targetNote(target: TargetSnapshot): string | undefined {
    if (!target.homeMissing) return lockedReason(target);

    const home = target.path.replace(/\/skills$/, '');
    const why = target.instances.length > 0 ? 'T3 Code’s provider instances read it; ' : '';

    return `Not installed until ${home} exists. ${why}Lar Factory installs here once it exists.`;
}

export function targetGroup({ targets }: PagesInput): Group {
    return {
        title: 'Skill folders',
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
                  title: 'Couldn’t read the bundled skills',
                  noteOnly: true,
                  description: 'The board server couldn’t read the app’s bundle, so it can’t credit them here.',
                  control: custom(() => null),
              },
          ];

    return { title: 'Bundled skills', help: 'The skills and checklists the app installs, and who wrote them.', rows };
}
