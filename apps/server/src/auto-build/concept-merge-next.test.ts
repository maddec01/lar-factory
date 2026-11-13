import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { openWorkRecords, type PullRequestState } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi, onTestFinished } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createItemCommands } from '../items/item-commands.ts';
import { createPrObserver } from '../items/pr-observer.ts';
import { recordItems } from '../items/record-items.ts';
import { createAutoBuild } from './auto-build.ts';

const repos = ['example/a', 'example/b', 'example/c'];
const choices: ModelGroup[] = [
    { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }] },
];

/** Only the provider and T3 transports are fake; starts, claims, observation and scheduling use their production modules. */
async function fixture(autoOn = false) {
    vi.useFakeTimers({ toFake: ['Date'] });

    const dir = mkdtempSync(join(tmpdir(), 'concept-merge-'));
    const records = await openWorkRecords(join(dir, 'work.db'));
    const rev = (id: string) => records.read(id).revision;
    const group = records.create({
        title: 'Deliver helpers',
        repository: repos[0]!,
        kind: 'concept',
        status: 'Shaping',
    }).workId;
    let age = 0;
    const build = (title: string, repository: string, parent = true) => {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, age++)));

        const id = records.create({ title, repository, kind: 'build', status: parent ? 'Ready' : 'List' }).workId;

        if (parent) records.setParent(id, rev(id), group);

        records.setBody(id, rev(id), 'brief', `Exact ${title}`);
        records.recordGate(id, rev(id), {
            briefDigest: records.gate(id).briefDigest!,
            approvedBy: 'test',
            evidence: 'Approved fixture.',
        });

        return id;
    };
    const a = build('Formatting helper', repos[0]!);
    const b = build('Independent length helper', repos[1]!);
    const next = build('Use formatting helper', repos[0]!);
    const standalone = build('Standalone code', repos[2]!, false);

    if (!autoOn) records.update(standalone, rev(standalone), { status: 'Ready' });

    records.addBlocker(next, rev(next), a);
    records.setFogGone(group, rev(group), true);
    records.setBody(group, rev(group), 'map', 'Approved destination.');

    const board = createBoardState({
        items: [],
        repos: [],
        modelChoices: choices,
        buildLimit: { limit: 1, automatic: 1 },
        t3Availability: { availability: 'available' },
    } as unknown as BoardData);
    const reread = () => board.update({ items: recordItems(records, [], repos) });

    reread();

    const launches: { id: string; base: unknown }[] = [];
    const states = new Map<string, PullRequestState | Error>();
    const commands = createItemCommands({
        board,
        records,
        reread,
        items: {} as never,
        archive: () => [],
        offerModelChoices: () => choices,
        factoryContext: null,
        clearedFailuresFile: null,
        skillsOf: () => [],
        shapingThreadCleanupChoice: () => 'keep',
        buildAccessOf: () => ({ 'push-branch': 'allowed', 'open-pr': 'allowed' }),
        projectOf: async (repository) => ({ projectId: repository }),
        baseOf: async () => 'main',
        fetchBase: async () => (records.completion(a).complete ? 'base-with-merged-helper' : 'initial-base'),
        startThread: async (_project, message, _selection, workspace) => {
            const id = [a, b, next, standalone].find(
                (candidate) => message.split('\n')[0] === `Build ${records.read(candidate).title}`,
            )!;

            launches.push({ id, base: workspace });

            return { thread: { threadId: `thread-${id}`, title: records.read(id).title }, error: null };
        },
    });
    const setting = { on: autoOn };
    const scheduler = createAutoBuild({
        board,
        records,
        commands,
        setting: () => setting,
        limit: () => 1,
        offerModelChoices: () => choices,
        dir,
    });
    let dispatched = Promise.resolve();
    const observer = createPrObserver(records, {
        repositories: () => repos,
        hidden: () => new Set(),
        waits: () => false,
        read: async (repository, number) => {
            const state = states.get(`${repository}#${number}`) ?? 'open';

            if (state instanceof Error) throw state;

            return state;
        },
        changed: () => {
            reread();
            dispatched = scheduler.pass();
        },
    });

    onTestFinished(async () => {
        await scheduler.release();
        records.close();
        rmSync(dir, { recursive: true, force: true });
        vi.useRealTimers();
    });

    const start = () => commands.setConceptBuildRun(group, rev(group), 'running');
    const handBack = async (id: string, number: number) => {
        const reference = `${records.read(id).repository}#${number}`;

        records.setPullRequest(id, rev(id), reference);
        records.update(id, rev(id), { status: 'Ready to merge' });
        states.set(reference, 'open');
        reread();
        await scheduler.pass();

        return reference;
    };
    let clock = 0;
    const poll = async () => {
        clock += 15_000;
        await observer.poll(clock);
        await dispatched;
    };

    return {
        records,
        rev,
        group,
        a,
        b,
        next,
        standalone,
        board,
        setting,
        launches,
        states,
        commands,
        scheduler,
        start,
        handBack,
        poll,
        reread,
    };
}

test('one Start makes parallel-capable progress at capacity one; only a provider merge starts the successor', async () => {
    const s = await fixture();

    expect(s.start().status).toBe(200);
    await s.scheduler.pass();
    expect(s.launches.map((row) => row.id)).toEqual([s.a]);

    const aPr = await s.handBack(s.a, 1);

    expect(s.launches.map((row) => row.id)).toEqual([s.a, s.b]);
    await s.handBack(s.b, 2);
    expect(s.records.read(s.next).status).toBe('Ready');
    s.records.attachTicket(s.a, s.rev(s.a), 'example/a#91');
    s.records.observe(s.a, s.rev(s.a), { of: 'ticket', state: 'closed' });
    s.records.update(s.a, s.rev(s.a), { status: 'Done' });
    s.reread();
    await s.scheduler.pass();
    expect(s.records.completion(s.a).complete).toBe(false);
    s.states.set(aPr, new Error('Provider unavailable'));
    await s.poll();
    expect(s.records.read(s.next).status).toBe('Ready');
    s.states.set(aPr, 'closed');
    await s.poll();
    expect(s.records.read(s.next).status).toBe('Ready');
    s.states.set(aPr, 'merged');
    await s.poll();
    expect(s.records.read(s.a).finishedAt).toBeTruthy();
    expect(s.launches.map((row) => row.id)).toEqual([s.a, s.b, s.next]);
    expect(s.launches[2]?.base).toMatchObject({ base: 'base-with-merged-helper' });
    await s.poll();
    await s.scheduler.pass();
    expect(s.records.launchIntents({ workId: s.next })).toHaveLength(1);
    expect(s.records.read(s.standalone).status).toBe('Ready');
});

test.each(['pause', 'auto-off'] as const)(
    '%s preserves active work and respects the explicit concept authorization at the next merge',
    async (mode) => {
        const s = await fixture(mode === 'auto-off');

        expect(s.start().status).toBe(200);
        await s.scheduler.pass();
        s.setting.on = false;
        s.records.update(s.standalone, s.rev(s.standalone), { status: 'Ready' });

        const aPr = await s.handBack(s.a, 1);

        await s.handBack(s.b, 2);

        if (mode === 'pause') s.commands.setConceptBuildRun(s.group, s.rev(s.group), 'paused');

        s.states.set(aPr, 'merged');
        await s.poll();

        if (mode === 'pause') {
            expect(s.launches.map((row) => row.id)).toEqual([s.a, s.b]);
            expect(s.start().status).toBe(200);
            await s.scheduler.pass();
        }

        expect(s.launches.map((row) => row.id)).toEqual([s.a, s.b, s.next]);
        expect(s.records.read(s.standalone).status).toBe('Ready');
        expect(s.records.launchIntents({ workId: s.next })).toHaveLength(1);
    },
);
