// What a row says its thread is doing, in its second line's text slot: a status mark, then the newest action, its age and
// the agents at work, or what stands in for an action that isn't happening now. packages/shared/src/thread-activity.ts
// keeps the rules. The line alone follows the second's clock, so a tick renders nothing around it. Its tooltip and the
// item dialog list the agents at work with one component.

import { itemActivityAgents, itemActivityLine, itemActivityStill, plural, shortAge } from '@lar-factory/shared';
import type { Item, ThreadActivityLine, ThreadActivityState, ThreadAgent } from '@lar-factory/shared';
import { Badge, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';

import { useBoardStore } from '../board/board-store.ts';
import { useClock } from '../board/second-clock.ts';
import { useActivityFeedback } from '../items/item-parts.tsx';

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

/** Quiet is hollow and stopped is square, so each reads apart from working without its colour. */
const MARK: Record<ThreadActivityState, string> = {
    working: 'rounded-full bg-(--st-now)',
    quiet: 'rounded-full border-[1.5px] border-(--warning-foreground)',
    waiting: 'rounded-full bg-(--st-amber)',
    stopped: 'rounded-[1px] bg-(--st-idle)',
    unavailable: 'rounded-full border-[1.5px] border-(--st-idle)',
};

/** The line's words for its state, which `data-action` marks, whatever draws them. */
function Words({ line: { state, action } }: { line: ThreadActivityLine }) {
    switch (state) {
        case 'working':
            return (
                <span data-action className="min-w-0 truncate text-(--foreground)">
                    {action}
                </span>
            );
        case 'quiet':
            return (
                <span data-action className="min-w-0 truncate font-medium text-(--warning-foreground) tabular-nums">
                    {action}
                </span>
            );
        case 'waiting':
            return (
                <Badge data-action data-activity-badge tone="warning" className="shrink-0">
                    {action}
                </Badge>
            );
        case 'stopped':
            return (
                <Badge data-action data-activity-badge className="shrink-0">
                    {action}
                </Badge>
            );
        case 'unavailable':
            return (
                <span data-action className="min-w-0 truncate">
                    {action}
                </span>
            );
    }
}

/** An action's age on the second's clock, so a tick renders nothing around it. */
function LiveAge({ at }: { at: string }) {
    return (
        <span data-agent-age className="shrink-0 tabular-nums opacity-70">
            {useClock((now) => shortAge(now - Date.parse(at)))}
        </span>
    );
}

/** The agents at work and what each does. `details` adds each one's model and action age. */
function AgentList({ agents, details = false }: { agents: ThreadAgent[]; details?: boolean }) {
    return (
        <ul data-agent-list className="m-0 grid min-w-0 list-none gap-1 p-0 text-left">
            {agents.map(({ title, model, action, actionAt }, index) => (
                <li key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-1.5">
                    <span className={`inline-block size-2 self-center ${MARK.working}`} />
                    <span className="flex min-w-0 gap-1.5">
                        <span className="min-w-0 truncate font-medium">{title}</span>
                        {details && model && <span className="shrink-0 opacity-70">· {model}</span>}
                    </span>
                    {details && actionAt ? <LiveAge at={actionAt} /> : <span />}
                    {action && (
                        <span title={action} className="col-span-2 col-start-2 truncate opacity-70">
                            {action}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** `item`'s agents at work in its details; nothing with none to list. */
export function ItemAgents({ item }: { item: Item }) {
    const disconnected = useBoardStore((state) => !!state.clientError);
    // Renders when the list goes unavailable; the ages in it move with their own clock.
    useClock((now) => itemActivityAgents(item, now, disconnected) === 'unavailable');
    const agents = itemActivityAgents(item, Date.now(), disconnected);
    if (!agents) return null;
    return (
        <section data-working-agents className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 text-xs">
            {agents === 'unavailable' ? (
                <p className="m-0 text-(--muted-foreground)">Activity unavailable</p>
            ) : (
                <>
                    <p className="m-0 font-medium">Working agents</p>
                    <AgentList agents={agents} details />
                </>
            )}
        </section>
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
    const now = Date.now();
    const line = itemActivityLine(item, now, disconnected);
    if (!line) return null;
    const agents = itemActivityAgents(item, now, disconnected);
    const listed = Array.isArray(agents) ? agents : undefined;
    const shown = (
        <span
            data-activity={line.state}
            tabIndex={listed ? 0 : undefined}
            className="flex min-w-0 items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
        >
            <span data-mark className={`inline-block size-2 shrink-0 ${MARK[line.state]}`} />
            <Words line={line} />
            {line.state !== 'quiet' && line.ageMs !== undefined && (
                <span data-age className="shrink-0 tabular-nums">
                    · {shortAge(line.ageMs)}
                </span>
            )}
            {line.agents > 0 && (
                <span data-agents className="shrink-0 tabular-nums">
                    · {plural(line.agents, 'agent')}
                </span>
            )}
        </span>
    );
    if (!listed) return shown;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{shown}</TooltipTrigger>
            <TooltipPopup side="bottom" align="start" className="max-w-md">
                <AgentList agents={listed} />
            </TooltipPopup>
        </Tooltip>
    );
}
