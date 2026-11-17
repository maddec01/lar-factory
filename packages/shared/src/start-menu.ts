// Start and its model menu: what a start posts, and which choice it remembers.

import { offers } from './model.ts';
import type { ModelChoice, ModelGroup, StartResult } from './model.ts';

/** The model choice an entry names by its data attributes; "Project default in T3" names none. */
export function choiceOf(entry: { instanceId?: string; model?: string }): ModelChoice | undefined {
    return entry.instanceId && entry.model ? { instanceId: entry.instanceId, model: entry.model } : undefined;
}

/** /api/start's body. Without a choice it sends no `model`, so T3 uses the project's default. */
export function startRequest(session: string | undefined, itemId: string, choice?: ModelChoice): object {
    return { session, itemId, ...(choice && { model: choice }) };
}

/** Whether a start's result makes its choice the one to remember: "Started" or "May have started", not a refusal or failure. */
export function remembersChoice(result: Partial<StartResult>): boolean {
    return Boolean(result.thread || result.uncertain);
}

/** A choice as the browser stores it; "Project default in T3" stores as null. */
export function storedChoice(choice: ModelChoice | undefined): string {
    return JSON.stringify(choice ?? null);
}

/** The choice the browser stored; none for "Project default in T3", nothing stored, or anything unreadable. */
export function readChoice(raw: string | null): ModelChoice | undefined {
    try {
        const value = JSON.parse(raw ?? 'null') as Partial<ModelChoice> | null;

        return typeof value?.instanceId === 'string' && typeof value.model === 'string'
            ? { instanceId: value.instanceId, model: value.model }
            : undefined;
    } catch {
        return undefined;
    }
}

/** The primary start's choice and the menu's highlighted entry: the remembered choice while offered, else "Project default in T3". */
export function highlightedChoice(groups: ModelGroup[], remembered: ModelChoice | undefined): ModelChoice | undefined {
    return remembered && offers(groups, remembered) ? remembered : undefined;
}
