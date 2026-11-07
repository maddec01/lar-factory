// What a row says its thread is doing, in its second line's text slot: a status mark, then the newest action, its age and
// the agents at work, or what stands in for an action that isn't happening now. packages/shared/src/thread-activity.ts
// keeps the rules. The line alone follows the second's clock, so a tick renders nothing around it. Its tooltip and the
// item dialog list the agents at work with one component.

import { itemActivityAgents, itemActivityLine, itemActivityStill, plural, shortAge } from '@lar-factory/shared';
import type { Item, ThreadActivityState, ThreadAgent } from '@lar-factory/shared';
import {
    ActivityLine as DesignActivityLine,
    AgentAge,
    AgentList as DesignAgentList,
    AgentRow,
    WorkingAgents,
} from '@lar-works/design-system';

import { useActivityFeedback } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';

/** The state of `item`'s line, if it shows one: a start in flight says its own progress. Its caller renders only when the state changes, not on every second. */
export function useActivityState(item: Item): ThreadActivityState | undefined {
    const disconnected = useBoardStore((state) => !!state.clientError);
    const { label } = useActivityFeedback(item);
    const state = useClock((now) => itemActivityLine(item, now, disconnected)?.state);

    return label === 'Starting' || label === 'May have started' ? undefined : state;
}

/** Whether `item`'s row stops animating, which a read going old changes with no new data. */
export function useActivityStill(item: Item): boolean {
    const disconnected = useBoardStore((state) => !!state.clientError);

    return useClock((now) => itemActivityStill(item, now, disconnected));
}

/** An action's age on the second's clock, so a tick renders nothing around it. */
function LiveAge({ at }: { at: string }) {
    return <AgentAge>{useClock((now) => shortAge(now - Date.parse(at)))}</AgentAge>;
}

/** The agents at work and what each does. `details` adds each one's model and action age. */
function AgentList({ agents, details = false }: { agents: ThreadAgent[]; details?: boolean }) {
    return (
        <DesignAgentList>
            {agents.map(({ title, model, action, actionAt }, index) => (
                <AgentRow
                    key={index}
                    title={title}
                    model={details ? model : undefined}
                    age={details && actionAt ? <LiveAge at={actionAt} /> : undefined}
                    action={action}
                />
            ))}
        </DesignAgentList>
    );
}

/** `item`'s agents at work in its details; nothing with none to list. */
export function ItemAgents({ item }: { item: Item }) {
    const disconnected = useBoardStore((state) => !!state.clientError);

    // Renders when the list goes unavailable; the ages in it move with their own clock.
    useClock((now) => itemActivityAgents(item, now, disconnected) === 'unavailable');

    // oxlint-disable-next-line react/purity -- the useClock above renders this again when the time changes the answer
    const agents = itemActivityAgents(item, Date.now(), disconnected);

    if (!agents) return null;

    return (
        <WorkingAgents
            heading="Working agents"
            unavailable={agents === 'unavailable' ? 'Activity unavailable' : undefined}
        >
            {agents !== 'unavailable' && <AgentList agents={agents} details />}
        </WorkingAgents>
    );
}

/** `item`'s line; nothing when it has none. */
export function ActivityLine({ item }: { item: Item }) {
    const disconnected = useBoardStore((state) => !!state.clientError);

    // Keep checking every second, including the quiet/stale deadlines, but render only when the shown words change.
    useClock((now) => {
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

    if (!line) return null;

    const agents = itemActivityAgents(item, now, disconnected);
    const listed = Array.isArray(agents) ? agents : undefined;

    return (
        <DesignActivityLine
            state={line.state}
            action={line.action}
            age={line.state !== 'quiet' && line.ageMs !== undefined ? shortAge(line.ageMs) : undefined}
            agents={line.agents > 0 ? plural(line.agents, 'agent') : undefined}
            agentList={listed && <AgentList agents={listed} />}
        />
    );
}
