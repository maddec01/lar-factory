// What the item dialog shows from an item's details: the description and comments in its main column, the people,
// kind control, labels and their picker, dates, milestone or iteration and area in the meta area under its title, and the
// sub-tickets in its sidebar. While the details load each shows a placeholder, and a failed read shows its error in the
// description's place; the board's own fields never wait. Once they load, Edit opens the description editor in the
// description's place, with Save and Cancel under it; the extra sections, such as Acceptance Criteria, stay read-only.
// Beside a work record's own text, the description and comments are the ticket's context and say so.

import { onAzure } from '@lar-factory/shared';
import type { Item, ItemDetails } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { ConceptState, ConceptWork } from './ConceptParts';
import { Fact, Person, Placeholder, When } from './DetailsParts';
import { ItemChecksSection } from './ItemChecks';
import { ItemKindControl } from './ItemKindControl';
import { ItemLabels } from './ItemLabels';
import { KindNotice } from './KindNotice';
import type { ItemDetailsRead } from './useItemDetails';
import { AgentWork, AgentWorkNote } from '@/features/items';

/** A fact from the details: a placeholder while they load, nothing once they failed or hold none. */
function FromDetails({
    read,
    label,
    show,
}: {
    read: ItemDetailsRead;
    label: string;
    show: (d: ItemDetails) => ReactNode;
}) {
    if (read.state === 'loading')
        return (
            <Fact label={label}>
                <Placeholder className="h-4 w-20" />
            </Fact>
        );

    if (read.state === 'failed') return null;

    const shown = show(read.details);

    return shown ? <Fact label={label}>{shown}</Fact> : null;
}

/**
 * The meta area under the title: author, assignees, labels, milestone or iteration and area, dates, a pull request item's
 * checks, and the agent work figures, which only show here while the dialog is too narrow for the header to hold them, or why
 * there are none. They wrap onto as many lines as the width needs. Labels, update time and checks come from the board.
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
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2" data-meta>
            {item.azure && (
                <>
                    <Fact label="Azure type">{item.azure.type}</Fact>
                    <Fact label="Azure state">{item.azure.state}</Fact>
                </>
            )}
            <FromDetails read={read} label="Author" show={(d) => d.author && <Person name={d.author} />} />
            <FromDetails
                read={read}
                label="Assignees"
                show={(d) =>
                    d.assignees.length > 0 && (
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                            {d.assignees.map((a) => (
                                <Person key={a} name={a} />
                            ))}
                        </span>
                    )
                }
            />
            <ItemKindControl item={item} />
            <ItemLabels key={item.id} item={item} />
            {azure ? (
                <>
                    <FromDetails read={read} label="Iteration" show={(d) => d.iteration} />
                    <FromDetails read={read} label="Area" show={(d) => d.area} />
                </>
            ) : (
                <FromDetails read={read} label="Milestone" show={(d) => d.milestone} />
            )}
            <FromDetails
                read={read}
                label="Created"
                show={(d) => d.createdAt && <When iso={d.createdAt} now={now} />}
            />
            <Fact label="Updated">
                <When iso={item.updatedAt} now={now} />
            </Fact>
            {item.kind === 'concept' && item.refinement && (
                <Fact label="Refinement">
                    <ConceptState state={item.refinement} />
                </Fact>
            )}
            {item.kind === 'concept' && item.completion && (
                <Fact label="Delivery">
                    <ConceptState state={item.completion} />
                </Fact>
            )}
            <AgentWorkNote item={item} />
            {item.kind === 'concept' ? <ConceptWork item={item} /> : <AgentWork item={item} only="narrow" />}
            {item.kind === 'build' && <ItemChecksSection key={item.id} itemId={item.id} />}
            <KindNotice key={`${item.id} notice`} item={item} read={read} refresh={refresh} />
        </div>
    );
}
