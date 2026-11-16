import { day, type BundledSkill } from '@lar-factory/shared';
// Settings' Skills page: who wrote each bundled skill.
import { InlineLink, Link, Text } from '@lar-works/design-system';

import { custom, type Group, type PagesInput, type Row } from './SettingsModel';
import { LoadFailed, MetaLine } from '@/ui/board';

/**
 * Who wrote each skill and checklist the app bundles, under which licence, its last update and a link to its source. A Copy's last update is its Date in UPSTREAM.md; Lar's own skills update with the app.
 */
export function bundledGroup({ data, version }: PagesInput): Group {
    const skills = data.bundledSkills ?? [];
    // A Date is a day with no time zone, so it reads the same everywhere. Neither a date nor a version breaks across lines.
    const updated = (skill: BundledSkill) =>
        skill.date ? (
            <Text as="span" variant="inherit" nowrap>
                updated {day(skill.date, 'UTC')}
            </Text>
        ) : skill.author === 'Lar' && version ? (
            <Text as="span" variant="inherit" nowrap>
                updated in Lar Factory {version}
            </Text>
        ) : null;
    const rows: Row[] = skills.length
        ? skills.map((skill) => ({
              id: `bundled-${skill.name}`,
              title: skill.name,
              description: (
                  <>
                      <MetaLine parts={[skill.author, skill.licence, updated(skill)]} />
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
                  </>
              ),
              control: custom(() => (
                  <Link variant="caption" external aria-label={`${skill.name} source`} href={skill.source}>
                      Source
                  </Link>
              )),
          }))
        : [
              {
                  id: 'bundled-unread',
                  title: 'Couldn’t load the bundled skills',
                  noteOnly: true,
                  control: {
                      type: 'row',
                      render: () => (
                          <LoadFailed
                              size="compact"
                              what="the bundled skills"
                              reason="The board server couldn’t read the app’s bundle, so it can’t credit them here."
                          />
                      ),
                  },
              },
          ];

    return { title: 'Bundled skills', help: 'The skills and checklists the app bundles, and who wrote them.', rows };
}
