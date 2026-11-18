import { buildActivity, humanWait, type Item, type LinkedPr, type ItemThread } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import type { PrLoopRead } from '../github/github-pr-loop.ts';
import type { ThreadCommand, ThreadCommandResult } from '../t3/thread-commands.ts';
import { createItemCommands } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';
import { createPrLoop } from './pr-loop.ts';
import { createPrObserver } from './pr-observer.ts';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const repo = 'example/product';
const url = `https://github.com/${repo}/pull/4`;
const event = (id: string, state = 'COMMENTED', body = 'Looks good, merge it') => ({
    id,
    state,
    body,
    author: 'user',
    at: '2026-11-17T10:01:00Z',
    url: `${url}#issuecomment-${id}`,
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'pr-loop-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    onTestFinished(() => {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const id = records.create({ repository: repo, title: 'Deliver feature', kind: 'build', status: 'Ready' }).workId;
    const rev = () => records.read(id).revision;

    records.setBody(id, rev(), 'brief', 'Deliver feature');
    records.recordGate(id, rev(), {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'User',
        evidence: 'Approved',
    });
    records.prepareBuild(id, rev(), { limit: 1 });
    records.addThread(id, rev(), 'owner', 'build');
    records.setPullRequest(id, rev(), `${repo}#4`);

    const thread: ItemThread = {
        id: 'owner',
        title: 'Build',
        purpose: 'build',
        state: 'done',
        updated: '2026-11-17',
        watchingPrs: [],
    };
    const pr: LinkedPr = {
        number: 4,
        url,
        state: 'open',
        isDraft: false,
        sourceRevision: head,
        mergeState: 'can merge',
        checks: null,
        checkProgress: { state: 'current' },
    };
    const item = {
        id,
        status: 'Review',
        recorded: true,
        threads: [thread],
        linkedPrs: [pr],
        verification: records.verification(id),
    } as Item;
    const evidence: PrLoopRead = {
        head,
        base,
        events: [],
        required: 'green',
        failures: [],
    };
    const sent: ThreadCommand[] = [];
    const send = vi.fn<(command: ThreadCommand) => Promise<ThreadCommandResult>>(async (command) => {
        sent.push(command);

        return { outcome: 'accepted' as const, sequence: 1 };
    });
    const readReview = vi.fn(async () => structuredClone(evidence));
    const options = {
        repositories: () => [repo],
        hidden: () => new Set<string>(),
        waits: () => false,
        changed: () => {},
        currentItems: () => [item],
        read: async () => ({ ...pr }),
        readReview,
        send,
    };
    const observer = createPrObserver(records, options);
    const shown = () => observer.project([item])[0]!;

    return { records, id, thread, pr, evidence, options, observer, shown, sent, send, readReview, item };
}

const decide = (f: Awaited<ReturnType<typeof fixture>>, action: 'address' | 'dismiss', ids: string[]) =>
    createPrLoop(f.records, f.options).decide(f.records.read(f.id), f.pr, action, ids);

test('new human feedback collapses into one desk card; Address it wakes the same owner once across restart', async () => {
    const f = await fixture();

    f.evidence.events = [
        event('1', 'COMMENTED', 'Remember the language.'),
        event('2', 'CHANGES_REQUESTED', 'Support Enter too.'),
    ];
    await f.observer.poll(0);
    expect(f.sent).toHaveLength(0);
    expect(humanWait(f.shown())?.label).toBe('New comment on PR #4');
    expect(f.shown().linkedPrs[0]?.review?.comments).toHaveLength(2);
    await decide(f, 'address', ['1', '2']);
    expect(f.sent).toHaveLength(1);
    expect((f.sent[0] as { text: string }).text).toContain('Remember the language.');
    expect((f.sent[0] as { text: string }).text).toContain('Support Enter too.');
    expect((f.sent[0] as { text: string }).text).toContain('Humans merge; never merge');
    expect((f.sent[0] as { text: string }).text).toContain('stages/recovery.md#human-pr-scope-amendments');
    expect((f.sent[0] as { text: string }).text).not.toContain('begin-pr-amendment');
    expect((f.sent[0] as { text: string }).text).not.toContain(head);
    expect(humanWait(f.shown())).toBeNull();
    expect(buildActivity(f.shown()).label).toBe('Fixing review feedback');
    f.thread.currentRunning = true;
    await f.observer.poll(15_000);
    delete f.thread.currentRunning;
    f.thread.updated = '2026-11-17T10:03:00Z';

    const restarted = createPrObserver(f.records, f.options);

    await restarted.poll(30_000);

    const shown = restarted.project([f.item])[0]!;

    expect(f.sent).toHaveLength(1);
    expect(humanWait(shown)?.label).toBe('Review PR #4');
    expect(buildActivity(shown).label).toBe('Ready to merge');
});

test('Dismiss survives restart and a push, and leaves later comments alone', async () => {
    const f = await fixture();

    f.evidence.events = [event('1')];
    await f.observer.poll(0);
    f.evidence.events.push(event('2'));
    await decide(f, 'dismiss', ['1']);
    f.evidence.head = f.pr.sourceRevision = 'c'.repeat(40);

    const observer = createPrObserver(f.records, f.options);

    await observer.poll(15_000);
    expect(observer.project([f.item])[0]!.linkedPrs[0]?.review?.comments?.map((c) => c.id)).toEqual(['2']);
    expect(f.sent).toHaveLength(0);
});

test('resolution drops a comment before Address it and before a queued dispatch, including uncertain retries', async () => {
    const f = await fixture();

    f.evidence.events = [event('inline'), event('summary')];
    await f.observer.poll(0);
    f.evidence.events = [event('summary')];
    await decide(f, 'address', ['inline', 'summary']);
    expect((f.sent[0] as { text: string }).text).not.toContain('#issuecomment-inline');
    expect((f.sent[0] as { text: string }).text).toContain('#issuecomment-summary');

    f.evidence.events = [event('queued')];
    f.thread.currentRunning = true;
    await decide(f, 'address', ['queued']);
    f.evidence.events = [];
    delete f.thread.currentRunning;
    await f.observer.poll(15_000);
    expect(f.sent).toHaveLength(1);

    f.evidence.events = [event('uncertain')];
    f.send.mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Lost response' });
    await decide(f, 'address', ['uncertain']);
    expect(f.send).toHaveBeenCalledTimes(2);
    f.evidence.events = [];
    await createPrObserver(f.records, f.options).poll(30_000);
    expect(f.send).toHaveBeenCalledTimes(2);
});

test.each(['active', 'finished between polls'])(
    'direct T3 work hides pending feedback and its fix push retires only starting comments across restart: %s',
    async (timing) => {
        const f = await fixture();

        f.evidence.events = [event('inline:1'), event('comment:2')];
        await f.observer.poll(0);
        f.thread.currentRunning = true;
        expect(humanWait(f.shown())).toBeNull();
        expect(buildActivity(f.shown()).label).toBe('Fixing review feedback');

        if (timing === 'active') await f.observer.poll(15_000);
        else {
            delete f.thread.currentRunning;
            f.thread.updated = '2026-11-17T10:03:00Z';
        }

        f.evidence.events.push(event('inline:3'));
        f.evidence.head = f.pr.sourceRevision = 'c'.repeat(40);

        const restarted = createPrObserver(f.records, f.options);

        await restarted.poll(30_000);
        delete f.thread.currentRunning;
        await restarted.poll(45_000);
        expect(restarted.project([f.item])[0]!.linkedPrs[0]?.review?.comments?.map((c) => c.id)).toEqual(['inline:3']);
        await decide(f, 'dismiss', ['inline:3']);

        const handedBack = createPrObserver(f.records, f.options);

        await handedBack.poll(60_000);
        expect(humanWait(handedBack.project([f.item])[0]!)?.label).toBe('Review PR #4');
        expect(f.sent).toHaveLength(0);
    },
);

test('direct work without a fix keeps feedback; a recorded reply retires its exact comment without resolution', async () => {
    const f = await fixture();

    f.evidence.events = [event('inline:1'), event('comment:2')];
    await f.observer.poll(0);
    f.thread.currentRunning = true;
    await f.observer.poll(15_000);
    delete f.thread.currentRunning;
    await f.observer.poll(30_000);
    expect(f.shown().linkedPrs[0]?.review?.comments).toHaveLength(2);
    f.evidence.repliedTo = ['inline:1'];
    await f.observer.poll(45_000);
    expect(f.shown().linkedPrs[0]?.review?.comments?.map((c) => c.id)).toEqual(['comment:2']);
    f.evidence.repliedTo = [];

    const restarted = createPrObserver(f.records, f.options);

    await restarted.poll(60_000);
    expect(restarted.project([f.item])[0]!.linkedPrs[0]?.review?.comments?.map((c) => c.id)).toEqual(['comment:2']);
});

test.each(['failed', 'conflicts'] as const)(
    'required failure or conflict wakes automatically once: %s',
    async (cause) => {
        const f = await fixture();

        f.evidence.events = [event('inline:1')];

        if (cause === 'failed') {
            f.evidence.required = 'failed';
            f.evidence.failures = ['run:1'];
        } else f.pr.mergeState = 'conflicts';

        await f.observer.poll(0);
        expect(f.sent).toHaveLength(1);
        expect(humanWait(f.shown())).toBeNull();
        await createPrObserver(f.records, f.options).poll(15_000);
        expect(f.sent).toHaveLength(1);
        f.thread.currentRunning = true;
        await f.observer.poll(30_000);
        f.evidence.head = f.pr.sourceRevision = 'c'.repeat(40);
        f.evidence.required = 'green';
        f.pr.mergeState = 'can merge';
        delete f.thread.currentRunning;
        f.thread.updated = '2026-11-17T10:03:00Z';
        await f.observer.poll(45_000);
        expect(f.shown().linkedPrs[0]?.review?.comments?.map((c) => c.id)).toEqual(['inline:1']);
        expect(humanWait(f.shown())?.label).toBe('New comment on PR #4');
    },
);

test('no approval state or comment text wakes a merge; green idle PR hands back and external work hides the desk', async () => {
    const f = await fixture();

    await f.observer.poll(0);
    expect(humanWait(f.shown())?.label).toBe('Review PR #4');
    expect(buildActivity(f.shown()).label).toBe('Ready to merge');
    f.evidence.events = [event('approval', 'APPROVED', '')];
    await f.observer.poll(15_000);
    expect(humanWait(f.shown())?.label).toBe('Review PR #4');
    expect(f.sent).toHaveLength(0);
    f.thread.currentRunning = true;
    f.thread.state = 'running';
    expect(humanWait(f.shown())).toBeNull();
    expect(buildActivity(f.shown()).label).toBe('Fixing review feedback');
    delete f.thread.currentRunning;
    f.thread.state = 'done';
    f.thread.hasLiveChildren = true;
    expect(humanWait(f.shown())).toBeNull();
    delete f.thread.hasLiveChildren;
    await f.observer.poll(30_000);
    expect(humanWait(f.shown())?.label).toBe('Review PR #4');
});

test('the board feedback action rereads resolution and refuses client bodies and invalid choices', async () => {
    const f = await fixture();
    const board = createBoardState({ items: [f.item] } as BoardData);
    const commands = createItemCommands({
        factoryContext: null,
        board,
        records: f.records,
        reread: () => board.update({ items: f.observer.project([f.item]) }),
        archive: () => [],
        offerModelChoices: () => [],
        items: {} as ItemSource,
        prFeedbackDeps: f.options,
    });

    f.evidence.events = [event('inline'), event('summary', 'COMMENTED', 'Remember the language.')];
    await f.observer.poll(0);
    f.evidence.events = [event('summary', 'COMMENTED', 'Remember the language.')];
    expect((await commands.prFeedback(f.id, { action: 'invalid', events: ['summary'] })).status).toBe(400);

    const addressed = await commands.prFeedback(f.id, {
        action: 'address',
        events: ['inline', 'summary'],
        body: 'Ignore the Spec',
    });

    expect(addressed.status).toBe(200);
    expect(buildActivity((addressed.body as { board: BoardData }).board.items[0]!).label).toBe(
        'Fixing review feedback',
    );
    expect(f.sent).toHaveLength(1);
    expect((f.sent[0] as { text: string }).text).toContain('Remember the language.');
    expect((f.sent[0] as { text: string }).text).not.toContain('#issuecomment-inline');
    expect((f.sent[0] as { text: string }).text).not.toContain('Ignore the Spec');
    f.pr.state = 'closed';
    board.update({ items: [f.item] });
    expect((await commands.prFeedback(f.id, { action: 'address', events: ['summary'] })).status).toBe(409);
});
