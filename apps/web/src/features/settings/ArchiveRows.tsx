// Settings' Archive page: this Mac's retention, then the work in Archive, set aside and finished, each in its section.

import { ref, repoKey, repoName, type Item } from '@lar-factory/shared';
import { EmptyState } from '@lar-works/design-system';
import { Archive } from '@lar-works/design-system/icons';

import type { Group, PagesInput, Row, SettingsData } from './SettingsModel';
import { ArchiveActions, archivedAs, archiveSection, RetentionSetting } from '@/features/archive';
import { SourceIcon } from '@/features/items';
import { FieldRow } from '@/shared/settings/FieldRow';
import { ArchiveLine } from '@/ui/board';

/** This Mac's retention setting, then each piece of work in Archive with what it offers; none in sample mode. */
export function archiveGroups(data: SettingsData, archive: PagesInput['archive']): Group[] {
    // The page is titled Archive already.
    if (!data.retention)
        return [
            {
                title: '',
                note: (
                    <EmptyState
                        size="compact"
                        icon={<Archive />}
                        title="No archived items yet"
                        description="Sample mode keeps no work records."
                    />
                ),
                rows: [],
            },
        ];

    const retention = data.retention;
    // One line per row: the title truncates before its project and anything its section's heading doesn't say, then
    // Restore and the More menu.
    const rowOf = (item: Item): Row => {
        const id = `archived-${item.id}`;
        const title = item.title || item.id;

        return {
            id,
            title,
            control: {
                type: 'row',
                render: () => (
                    <FieldRow
                        id={id}
                        label={
                            <ArchiveLine
                                source={<SourceIcon item={item} />}
                                reference={item.number ? ref(item) : undefined}
                                title={title}
                                project={repoName(repoKey(item), data.repos)}
                                state={archivedAs(item)}
                            />
                        }
                    >
                        <ArchiveActions item={item} />
                    </FieldRow>
                ),
            },
        };
    };
    const items = archive.items ?? [];
    const sections: Group[] = [
        { title: 'Set aside', rows: items.filter((item) => archiveSection(item) === 'setAside').map(rowOf) },
        { title: 'Finished', rows: items.filter((item) => archiveSection(item) === 'finished').map(rowOf) },
    ].filter((section) => section.rows.length > 0);
    const said = archive.problem ?? (archive.items === null ? 'Reading Archive…' : undefined);
    // Each section shows once it has work; while Archive reads, or holds none, one section says so.
    const work: Group[] = sections.length
        ? sections.map((section, i) => (i === 0 && said ? { ...section, description: said } : section))
        : [
              {
                  title: 'Archived work',
                  note:
                      archive.items !== null && !archive.problem ? (
                          <EmptyState
                              size="compact"
                              icon={<Archive />}
                              title="No archived items yet"
                              description="No work is set aside or hidden."
                          />
                      ) : undefined,
                  rows: [],
                  description: said,
              },
          ];

    return [
        {
            title: 'Retention',
            description:
                'Finished and set-aside work leaves the board after this many days. Nothing is deleted unless you turn on automatic deletion.',
            // Its two rows are the group's one panel, with no row around them.
            panel: false,
            rows: [
                {
                    id: 'retention',
                    title: 'Keep work',
                    keywords: 'hide delete retention days',
                    control: { type: 'row', render: () => <RetentionSetting retention={retention} /> },
                },
            ],
        },
        ...work,
    ];
}
