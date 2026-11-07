// Settings' Archive page: this Mac's retention, then the work in Archive.

import { shownRepo } from '@lar-factory/shared';
import { RepoIdentity } from '@lar-works/design-system';

import { custom, type Group, type PagesInput, type Row, type SettingsData } from './SettingsModel';
import { ArchiveActions, archivedAs, RetentionSetting } from '@/features/archive';
import { SourceIcon } from '@/features/items';

/** This Mac's retention setting, then each piece of work in Archive with what it offers; none in sample mode. */
export function archiveGroups(data: SettingsData, archive: PagesInput['archive']): Group[] {
    if (!data.retention) return [{ title: 'Archive', description: 'Sample mode keeps no work records.', rows: [] }];

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
                'Finished and set-aside work leaves the board after this many days. Nothing is deleted unless you turn on a timed delete.',
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
            rows: work,
            description:
                archive.problem ??
                (archive.items === null
                    ? 'Reading Archive…'
                    : work.length
                      ? undefined
                      : 'No work is set aside or hidden.'),
        },
    ];
}
