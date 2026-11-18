// What a row says its thread is doing, in its second line's text slot: a status mark, then the newest action, its age and
// the agents at work, or what stands in for an action that isn't happening now. packages/shared/src/thread-activity.ts
// keeps the rules. The line alone follows the second's clock, so a tick renders nothing around it. Its tooltip and the
// item dialog list the agents at work with one component.

import type { Item, ThreadAgent } from '@lar-factory/shared';
import {
    itemActivityAgents,
    itemActivityLine,
    plural,
    shortAge,
    modelDisplayName,
    untilShortAgeChanges,
} from '@lar-factory/shared';
import { Alert, Disclosure, Text } from '@lar-works/design-system';

import { useItemClock, useShownStatus } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';
import {
    ActivityLine as DesignActivityLine,
    AgentAge,
    AgentList as DesignAgentList,
    AgentRow,
    DetailFact,
    FactList,
    WorkingAgents,
} from '@/ui/board';

/** An action's age, read again when the unit it shows changes, so a tick renders nothing around it. */
function LiveAge({ at }: { at: string }) {
    const since = Date.parse(at);

    return (
        <AgentAge>
            {useClock(
                (now) => shortAge(now - since),
                (now) => untilShortAgeChanges(since, now),
            )}
        </AgentAge>
    );
}

/** The agents at work and what each does. `details` adds each one's model and action age. */
function AgentList({ agents, details = false }: { agents: ThreadAgent[]; details?: boolean }) {
    const groups = useBoardStore((state) => state.data.modelChoices);

    return (
        <DesignAgentList>
            {agents.map(({ title, model, action, actionDetail, actionAt }, index) => (
                <AgentRow
                    key={index}
                    // One agent leads with what it does: its thread's name says nothing a reader needs.
                    title={agents.length === 1 && action ? action : [title, action].filter(Boolean).join(' · ')}
                    model={details && model ? modelDisplayName(groups, model) : undefined}
                    age={details && actionAt ? <LiveAge at={actionAt} /> : undefined}
                    action={details ? undefined : actionDetail}
                    state={action === 'Waiting for your answer' ? 'waiting' : 'working'}
                />
            ))}
        </DesignAgentList>
    );
}

/** `item`'s agents at work in its details; nothing with none to List. */
export function ItemAgents({ item }: { item: Item }) {
    const shown = useShownStatus(item);
    const disconnected = useBoardStore((state) => !!state.clientError);

    // Renders when the list goes unavailable; the ages in it move with their own clock.
    useItemClock(item, (now) => itemActivityAgents(item, now, disconnected) === 'unavailable');

    // oxlint-disable-next-line react/purity -- the useClock above renders this again when the time changes the answer
    const agents = itemActivityAgents(item, Date.now(), disconnected);

    if (!agents) return null;

    return (
        <WorkingAgents heading={shown.execution === 'working' ? 'Working now' : 'Last activity'}>
            {agents === 'unavailable' ? (
                <Alert
                    size="sm"
                    tone="info"
                    title="Activity unavailable"
                    message="The board couldn’t read the latest thread activity from T3. Check that T3 is connected, or open the thread there. The board tries again automatically."
                />
            ) : (
                <>
                    <AgentList agents={agents} details />
                    {agents.some((agent) => agent.actionDetail) && (
                        <Disclosure label="Activity details" presentation="section">
                            <FactList>
                                {agents.map((agent, index) =>
                                    agent.actionDetail ? (
                                        <DetailFact key={index} label={agent.title} presentation="record">
                                            <Text breaks>{agent.actionDetail}</Text>
                                        </DetailFact>
                                    ) : null,
                                )}
                            </FactList>
                        </Disclosure>
                    )}
                </>
            )}
        </WorkingAgents>
    );
}

/** `item`'s line; nothing when it has none. A `word`, such as "Fixing review feedback", leads it in place of the
 *  thread's action, which its tooltip then says with any `detail`. */
export function ActivityLine({
    item,
    word,
    detail,
}: {
    item: Item;
    word?: string | undefined;
    detail?: string | undefined;
}) {
    const disconnected = useBoardStore((state) => !!state.clientError);

    // Check every second while the item has a thread to follow, including the quiet and stale deadlines, but render
    // only when the shown words change.
    useItemClock(item, (now) => {
        const line = itemActivityLine(item, now, disconnected);

        return (
            line &&
            JSON.stringify([
                line.state,
                line.action,
                line.agents,
                line.state !== 'quiet' && line.ageMs !== undefined ? shortAge(line.ageMs) : null,
            ])
        );
    });

    // oxlint-disable-next-line react/purity -- the useClock above renders this again when the time changes the words
    const now = Date.now();
    const line = itemActivityLine(item, now, disconnected);

    if (!line || line.state === 'unavailable') return null;

    const agents = itemActivityAgents(item, now, disconnected);
    const listed = Array.isArray(agents) ? agents : undefined;

    return (
        <DesignActivityLine
            state={line.state}
            action={line.action}
            word={word || undefined}
            detail={detail}
            age={line.state !== 'quiet' && line.ageMs !== undefined ? shortAge(line.ageMs) : undefined}
            agents={line.agents > 0 ? plural(line.agents, 'agent') : undefined}
            agentList={listed && <AgentList agents={listed} />}
        />
    );
}
