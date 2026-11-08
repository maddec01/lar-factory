// Settings' Archive page: this Mac's retention, then the work in Archive.

import { shownRepo } from '@lar-factory/shared';
import { EmptyState } from '@lar-works/design-system';
import { Archive } from '@lar-works/design-system/icons';

import { custom, type Group, type PagesInput, type Row, type SettingsData } from './SettingsModel';
import { ArchiveActions, archivedAs, RetentionSetting } from '@/features/archive';
import { SourceIcon } from '@/features/items';
import { RepoIdentity } from '@/ui/board';

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
    const work: Row[] = (archive.items ?? []).map((item) => ({
        id: `archived-${item.id}`,
        title: item.title || item.id,
        description: (
            <RepoIdentity
                presentation="wrap"
                icon={<SourceIcon item={item} />}
                name={[shownRepo(item.repo), item.number ? `#${item.number}` : 'No ticket', archivedAs(item)].join(
                    ' · ',
                )}
            />
        ),
        control: custom(() => <ArchiveActions item={item} />),
    }));

    return [
        {
            title: 'Retention',
            description:
                'Finished and set-aside work leaves the board after this many days. Nothing is deleted unless you turn on automatic deletion.',
            rows: [
                {
                    id: 'retention',
                    title: 'Keep work',
                    control: custom(() => null),
                    below: <RetentionSetting retention={retention} />,
                },
            ],
        },
        {
            title: 'Set aside and hidden',
            note:
                archive.items !== null && !work.length && !archive.problem ? (
                    <EmptyState
                        size="compact"
                        icon={<Archive />}
                        title="No archived items yet"
                        description="No work is set aside or hidden."
                    />
                ) : undefined,
            rows: work,
            description:
                archive.problem ?? (archive.items === null ? 'Reading Archive…' : work.length ? undefined : undefined),
        },
    ];
}
