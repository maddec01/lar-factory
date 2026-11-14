// What a row says its thread is doing, in its second line's text slot: a status mark, then the newest action, its age and
// the agents at work, or what stands in for an action that isn't happening now. packages/shared/src/thread-activity.ts
// keeps the rules. The line alone follows the second's clock, so a tick renders nothing around it. Its tooltip and the
// item dialog list the agents at work with one component.

import type { Item, ThreadAgent } from '@lar-factory/shared';
import { itemActivityAgents, itemActivityLine, plural, shortAge, modelDisplayName } from '@lar-factory/shared';
import { Alert } from '@lar-works/design-system';

import { useShownStatus } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { useClock } from '@/shared/time/useClock';
import {
    ActivityLine as DesignActivityLine,
    AgentAge,
    AgentList as DesignAgentList,
    AgentRow,
    WorkingAgents,
} from '@/ui/board';

/** An action's age on the second's clock, so a tick renders nothing around it. */
function LiveAge({ at }: { at: string }) {
    return <AgentAge>{useClock((now) => shortAge(now - Date.parse(at)))}</AgentAge>;
}

/** The agents at work and what each does. `details` adds each one's model and action age. */
function AgentList({ agents, details = false }: { agents: ThreadAgent[]; details?: boolean }) {
    const groups = useBoardStore((state) => state.data.modelChoices);

    return (
        <DesignAgentList>
            {agents.map(({ title, model, action, actionAt }, index) => (
                <AgentRow
                    key={index}
                    // One agent leads with what it does: its thread's name says nothing a reader needs.
                    title={agents.length === 1 && action ? action : title}
                    model={details && model ? modelDisplayName(groups, model) : undefined}
                    age={details && actionAt ? <LiveAge at={actionAt} /> : undefined}
                    action={agents.length === 1 ? undefined : action}
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
    useClock((now) => itemActivityAgents(item, now, disconnected) === 'unavailable');

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
                <AgentList agents={agents} details />
            )}
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

    if (!line || line.state === 'unavailable') return null;

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
