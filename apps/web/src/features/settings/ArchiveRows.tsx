// Settings' Archive page: this Mac's retention, then the work in Archive, set aside and finished, each in its section.

import { ref, type Item } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';
import { Archive } from '@lar-works/design-system/icons';

import { emptyGroup, stateGroup } from './SettingsEmpty';
import type { Group, PagesInput, Row, SettingsData } from './SettingsModel';
import { ArchiveActions, archivedAs, archiveSection, RetentionSetting } from '@/features/archive';
import { RepoCell, SourceIcon } from '@/features/items';
import { RowKindMark } from '@/features/line';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';
import { ArchiveLine, ItemTitle, LoadFailed } from '@/ui/board';

/** This Mac's retention setting, then each piece of work in Archive with what it offers; none in sample mode. */
export function archiveGroups(data: SettingsData, archive: PagesInput['archive']): Group[] {
    // The page is titled Archive already.
    if (!data.retention)
        return [
            emptyGroup({
                id: 'archive-empty',
                icon: <Archive />,
                title: 'No archived items yet',
                description: 'Sample mode keeps no work records.',
            }),
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
                                source={
                                    <>
                                        <RowKindMark item={item} listed />
                                        <SourceIcon item={item} bare always />
                                    </>
                                }
                                name={item.number ? `${ref(item)} ${title}` : title}
                                title={<ItemTitle reference={item.number ? ref(item) : undefined} title={title} />}
                                project={<RepoCell item={item} />}
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
    // A read that failed says so above the work it last read; each section shows once it has work; while Archive
    // first reads, or holds none, one section says so.
    const failed: Group[] = archive.problem
        ? [
              stateGroup({
                  id: 'archive-failed',
                  heading: sections.length ? '' : 'Archived work',
                  title: 'Couldn’t load Archive',
                  state: (
                      <LoadFailed
                          size="compact"
                          what="Archive"
                          reason={archive.problem}
                          onRetry={() => void useArchiveStore.getState().load()}
                      />
                  ),
              }),
          ]
        : [];
    const work: Group[] = sections.length
        ? sections
        : archive.problem
          ? []
          : archive.items === null
            ? [
                  stateGroup({
                      id: 'archive-loading',
                      heading: 'Archived work',
                      title: 'Loading Archive…',
                      state: <Loading presentation="status" label="Loading Archive…" />,
                  }),
              ]
            : [
                  emptyGroup({
                      id: 'archive-empty',
                      heading: 'Archived work',
                      icon: <Archive />,
                      title: 'No archived items yet',
                      description: 'No work is set aside or hidden.',
                  }),
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
        ...failed,
        ...work,
    ];
}
