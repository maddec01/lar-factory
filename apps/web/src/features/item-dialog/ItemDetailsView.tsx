// What the item dialog shows from an item's details: the description and comments in its main column, the people,
// kind control, labels and their picker, dates, milestone or iteration and area in the meta area under its title, and the
// sub-tickets in its sidebar. While the details load only the board's own facts show, with one quiet loading line in the
// description's place, and a failed read shows its error there; the board's own fields never wait. Once they load, Edit opens the description editor in the
// description's place, with Save and Cancel under it; the extra sections, such as Acceptance Criteria, stay read-only.
// Beside a work record's own text, the description and comments are the ticket's context and say so.

import { onAzure, shortAgo } from '@lar-factory/shared';
import type { Item, ItemDetails } from '@lar-factory/shared';
import { Inline, Person } from '@lar-works/design-system';
import {
    CalendarIcon,
    CircleDotIcon,
    ClockIcon,
    FlagIcon,
    FolderTreeIcon,
    LayersIcon,
    ListChecksIcon,
    RepeatIcon,
    UserIcon,
    UsersIcon,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { ConceptState } from './ConceptParts';
import { When } from './DetailsParts';
import { ItemKindFeedback } from './ItemKindControl';
import { ItemLabels } from './ItemLabels';
import { KindNotice } from './KindNotice';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { DetailFact as Fact, MetaArea } from '@/ui/board';

/** A fact from the details: nothing until they load (the main column's one loading line stands for them), nothing once
 *  they failed or hold none. */
function FromDetails({
    read,
    label,
    icon,
    labelHidden,
    show,
}: {
    read: ItemDetailsRead;
    label: string;
    icon: ReactNode;
    labelHidden?: boolean;
    show: (d: ItemDetails) => ReactNode;
}) {
    if (read.state !== 'loaded') return null;

    const shown = show(read.details);

    return shown ? (
        <Fact label={label} icon={icon} labelHidden={labelHidden}>
            {shown}
        </Fact>
    ) : null;
}

/**
 * The meta area under the title: author, assignees, labels, milestone or iteration and area, dates, a pull request item's
 * checks, and a concept’s labelled total with its parts. Facts wrap onto as many lines as the width needs.
 * Labels, update time and checks come from the board; direct work stays in the header at every width.
 */
export function ItemMeta({
    item,
    read,
    refresh,
    now,
}: {
    item: Item;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
    now: number;
}) {
    const azure = Boolean(item.repo && onAzure(item.repo));

    return (
        <MetaArea data-meta notice={<KindNotice key={`${item.id} notice`} item={item} read={read} refresh={refresh} />}>
            {item.azure && (
                <>
                    <Fact label="Azure type" icon={<LayersIcon />}>
                        {item.azure.type}
                    </Fact>
                    <Fact label="Azure state" icon={<CircleDotIcon />}>
                        {item.azure.state}
                    </Fact>
                </>
            )}
            <FromDetails
                read={read}
                label="Opened by"
                icon={<UserIcon />}
                show={(d) => d.author && <Person name={d.author} />}
            />
            <FromDetails
                read={read}
                label="Assigned to"
                icon={<UsersIcon />}
                show={(d) =>
                    d.assignees.length > 0 && (
                        <Inline as="span" wrap space="related">
                            {d.assignees.map((a) => (
                                <Person key={a} name={a} />
                            ))}
                        </Inline>
                    )
                }
            />
            <ItemKindFeedback item={item} />
            <ItemLabels key={`labels-${item.id}`} item={item} />
            {azure ? (
                <>
                    <FromDetails
                        read={read}
                        label="Iteration"
                        icon={<RepeatIcon />}
                        labelHidden
                        show={(d) => d.iteration}
                    />
                    <FromDetails read={read} label="Area" icon={<FolderTreeIcon />} labelHidden show={(d) => d.area} />
                </>
            ) : (
                <FromDetails read={read} label="Milestone" icon={<FlagIcon />} labelHidden show={(d) => d.milestone} />
            )}
            <FromDetails
                read={read}
                label="Created"
                icon={<CalendarIcon />}
                show={(d) => d.createdAt && <When iso={d.createdAt} now={now} />}
            />
            {/* Updated says something only once it is later than Created. */}
            {!(
                read.state === 'loaded' &&
                read.details.createdAt &&
                (Date.parse(item.updatedAt) <= Date.parse(read.details.createdAt) ||
                    shortAgo(item.updatedAt, now) === shortAgo(read.details.createdAt, now))
            ) && (
                <Fact label="Updated" icon={<ClockIcon />}>
                    <When iso={item.updatedAt} now={now} />
                </Fact>
            )}
            {/* The parts' delivery line already says what's left to decide once the concept has parts. */}
            {item.kind === 'concept' &&
                item.status !== 'Done' &&
                !item.releasePlan &&
                item.refinement &&
                !item.completion && (
                    <Fact label="Decisions" icon={<ListChecksIcon />}>
                        <ConceptState state={item.refinement} />
                    </Fact>
                )}
        </MetaArea>
    );
}
