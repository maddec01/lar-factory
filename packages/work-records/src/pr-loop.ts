import { randomUUID } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import type { PrEvent } from './github-pr-review.ts';
import type { WorkRecord } from './work-records.ts';

export interface PrLoopState {
    pr: string;
    amendment?: { source: string; by: string; evidence: string; workIds?: string[] };
    feedback?: { threadId: string; ownerUpdatedAt: string; started?: boolean; key?: string };
    head?: string;
    owner?: { threadId: string; updatedAt: string };
    ownerWork?: { threadId: string; head: string; events: string[] };
    pending?: PrEvent[];
    requested?: string[];
    handled?: string[];
    events: Record<string, { commandId: string; messageId: string; threadId: string; text: string; sent: boolean }>;
    agentComments: string[];
}

export interface PrLoopRecords {
    prLoop(id: string): PrLoopState;
    savePrLoop(id: string, state: PrLoopState): void;
    recordPrAgentComment(id: string, url: string): void;
    prLoopEvent(id: string, key: string, threadId: string, text: string): PrLoopState['events'][string];
    prLoopDelivery(id: string, key: string, outcome: 'accepted' | 'rejected' | 'unconfirmed'): void;
}

/** Observer evidence and outbox survive restart. Unconfirmed dispatches reuse T3's idempotency key. */
export function prLoopRecords(database: Database, read: (id: string) => WorkRecord): PrLoopRecords {
    const { db } = database;
    const get = (id: string): PrLoopState => {
        const pr = read(id).pullRequest ?? '';
        const row = db.prepare('SELECT content FROM pr_loop WHERE work_id=?').get(id);
        const saved = row ? (JSON.parse(String(row.content)) as PrLoopState) : undefined;

        return saved?.pr === pr ? saved : { pr, events: {}, agentComments: [] };
    };
    const save = (id: string, state: PrLoopState) => {
        if (!state.pr || read(id).pullRequest !== state.pr)
            throw new WorkRecordError('invalid', 'The delivery PR changed.');

        db.prepare('INSERT OR REPLACE INTO pr_loop(work_id,content) VALUES(?,?)').run(id, JSON.stringify(state));
    };

    return {
        prLoop: (id) => database.read(() => get(id)),
        savePrLoop: (id, state) => database.write(() => save(id, state)),
        recordPrAgentComment: (id, url) =>
            database.write(() => {
                const state = get(id);
                const [repo, number] = state.pr.split('#');

                if (
                    !url.startsWith(`https://github.com/${repo}/pull/${number}#`) ||
                    !/#(?:issuecomment-|discussion_r|pullrequestreview-)\d+$/.test(url)
                )
                    throw new WorkRecordError('invalid', 'Use a comment URL on the recorded delivery PR.');

                if (!state.agentComments.includes(url)) state.agentComments.push(url);

                save(id, state);
            }),
        prLoopEvent: (id, key, threadId, text) =>
            database.write(() => {
                const state = get(id);
                const event = (state.events[key] ??= {
                    commandId: randomUUID(),
                    messageId: randomUUID(),
                    threadId,
                    text,
                    sent: false,
                });

                save(id, state);

                return event;
            }),
        prLoopDelivery: (id, key, outcome) =>
            database.write(() => {
                const state = get(id);
                const event = state.events[key];

                if (!event || event.sent) return;

                if (outcome === 'accepted') event.sent = true;

                if (outcome === 'rejected') Object.assign(event, { commandId: randomUUID(), messageId: randomUUID() });

                save(id, state);
            }),
    };
}
