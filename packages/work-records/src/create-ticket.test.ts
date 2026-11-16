import type { RepoConfig, TicketCreationOptions, TrackerLabels } from '@lar-factory/shared';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { createAgentTicket } from './agent-tracker-writes.ts';
import { agentWrites } from './agent-writes.ts';
import { captureWork, createRecordTicket, recordTicketPreview } from './create-ticket.ts';
import { refreshSpecs } from './spec-sync.ts';
import type { StructureProvider, StructureTicket } from './tracker-sync.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const REPO = 'example/product';
const opened: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const options: TicketCreationOptions = {
    provider: 'github',
    labels: ['bug'],
    types: ['Bug'],
    assignees: ['person'],
    milestones: [{ value: '1', name: 'Next' }],
    iterations: [],
    problems: [],
};

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'convert-ticket-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ dir, records });

    const local = records.create({ repository: REPO, kind: 'bug', title: 'Fix export', context: 'Original request.' });
    const repo = {
        repo: REPO,
        labels: [],
        role: '',
        setup: {
            repo: REPO,
            access: {
                'publish-ticket': 'allowed',
                'edit-ticket': 'allowed',
                'tag-ticket': 'allowed',
                'type-ticket': 'allowed',
            },
            vocabulary: { bug: { labels: ['bug'], type: 'Bug' } },
        },
    } as unknown as RepoConfig;
    const writes: unknown[][] = [];
    const provider = {
        create: async (...args: unknown[]) => {
            writes.push(args);

            return { repository: args[0], title: args[1], body: args[2], number: 13, version: '1' };
        },
    } as unknown as StructureProvider;
    const deps = { records, repos: () => [repo], provider, discoverOptions: async () => options };
    const convert = (extra: Record<string, unknown> = {}) =>
        createRecordTicket(
            local.workId,
            { requestId: REQUEST, revision: records.read(local.workId).revision, ...extra },
            deps,
        );

    return { records, local, repo, writes, deps, convert };
}

test('conversion sends only the current passing brief as Spec when enabled, with description as Original', async () => {
    const { records, local, repo, convert, writes } = await setup();
    let record = records.setBody(local.workId, local.revision, 'brief', '## What\nFix export.');

    expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
    records.recordGate(record.workId, record.revision, {
        briefDigest: records.gate(record.workId).briefDigest!,
        approvedBy: 'user',
        evidence: 'passed',
    });
    expect(recordTicketPreview(records, local.workId, [repo]).description).toContain('<summary>Original</summary>');
    repo.setup!.writeRefinedSpec = false;
    expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
    repo.setup!.writeRefinedSpec = true;
    record = records.read(local.workId);
    records.setBody(local.workId, record.revision, 'brief', '## What\nA changed brief.');
    expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
    record = records.read(local.workId);
    records.recordGate(record.workId, record.revision, {
        briefDigest: records.gate(record.workId).briefDigest!,
        approvedBy: 'user',
        evidence: 'passed again',
    });
    expect((await convert()).status).toBe(200);
    expect(String(writes[0]![2])).toMatch(/A changed brief\.[\s\S]*Original request\./);
    expect(records.initialContext(local.workId)).toBe('Original request.');
    expect((await convert()).body.record?.workId).toBe(local.workId);
    expect(writes).toHaveLength(1);
});

test('refused creation leaves the work local, reports failure and permits a new submission', async () => {
    const { repo, records, local, convert, writes } = await setup();

    repo.setup!.access['publish-ticket'] = 'refused';
    expect((await convert({ retro: true })).body.error).toMatch(/refused/i);
    expect(records.read(local.workId).ticket).toBeNull();
    expect(writes).toHaveLength(0);
    repo.setup!.access['publish-ticket'] = 'allowed';
    expect((await convert({ requestId: SECOND })).status).toBe(200);
});

test('an uncertain conversion survives reopening the database and blocks a second submission', async () => {
    const { records, local, deps, convert } = await setup();
    let ticket: StructureTicket | undefined;
    let writes = 0;

    deps.provider.create = async (repository, title, body) => {
        writes++;
        ticket = { repository, title, body, number: 14, version: '1' };
        throw Error('Response lost');
    };
    deps.provider.find = async () => (ticket ? [ticket] : []);
    expect((await convert()).body.uncertain).toBe(true);
    expect((await convert({ requestId: SECOND })).body.error).toMatch(/already has a ticket creation submission/);
    expect(records.read(local.workId).ticket).toBeNull();

    const handle = opened[0]!;

    records.close();
    handle.records = await openWorkRecords(join(handle.dir, 'work-records.db'));
    deps.records = handle.records;

    const recovered = await createRecordTicket(local.workId, { requestId: REQUEST, revision: local.revision }, deps);

    expect(recovered.body.record).toMatchObject({ workId: local.workId, ticket: `${REPO}#14` });
    expect(writes).toBe(1);
});

test('conversion ignores client text, validates options and refuses stale previews before creating', async () => {
    const { convert, local, writes } = await setup();

    expect((await convert({ revision: local.revision + 1 })).status).toBe(409);
    expect((await convert({ options: { unexpected: 'x' } })).status).toBe(422);
    expect(
        (
            await convert({
                draft: { title: 'Injected' },
                title: 'Injected',
                description: 'Injected',
                options: { labels: ['bug'], type: 'Bug', assignee: 'person', milestone: '1' },
            })
        ).status,
    ).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toBe('Fix export');
    expect(writes[0]![5]).toEqual({ labels: ['bug'], type: 'Bug', assignee: 'person', milestone: '1' });
});

test('a confirmed ticket with a failed attachment can recover without creating a second record or issue', async () => {
    const { records, local, convert, writes } = await setup();
    const complete = records.completeCapture;

    records.completeCapture = () => {
        throw Error('Disk full');
    };

    const failed = await convert();

    expect(failed.body.error).toContain(`Created ${REPO}#13`);
    expect(records.read(local.workId).ticket).toBeNull();
    records.completeCapture = complete;

    const recovered = await convert();

    expect(recovered.body.record).toMatchObject({ workId: local.workId, ticket: `${REPO}#13` });
    expect(records.list({})).toHaveLength(1);
    expect(writes).toHaveLength(1);
});

test.each([
    { stage: 'checkpoint', editorWrite: false },
    { stage: 'response', editorWrite: true },
])(
    'recovery checks provenance of edits before retry after a failed $stage, editorWrite=$editorWrite',
    async ({ stage, editorWrite }) => {
        const { records, local, deps, convert } = await setup();
        const brief = records.setBody(local.workId, local.revision, 'brief', 'Gated Spec.');

        records.recordGate(local.workId, brief.revision, {
            briefDigest: records.gate(local.workId).briefDigest!,
            approvedBy: 'user',
            evidence: 'pass',
        });

        let remote!: StructureTicket;
        let creates = 0;

        deps.provider.create = async (repository, title, body) => {
            creates++;
            remote = { repository, number: 31, title, body, version: '1' };

            if (stage === 'response') throw Error('Response lost');

            return remote;
        };
        deps.provider.find = async () => [remote];
        deps.provider.readSpec = async () => remote;

        const save = records.saveSpecState;

        if (stage === 'checkpoint')
            records.saveSpecState = () => {
                throw Error('Disk full');
            };

        expect((await convert()).status).toBe(stage === 'response' ? 409 : 502);
        records.saveSpecState = save;
        remote = {
            ...remote,
            body: remote.body.replace('Gated Spec.', 'Edited on tracker.'),
            title: 'Edited title',
            version: '2',
            editorWrite,
            titleEditorWrite: editorWrite,
        };

        const handle = opened[0]!;

        records.close();
        handle.records = await openWorkRecords(join(handle.dir, 'work-records.db'));
        deps.records = handle.records;

        const recovered = await createRecordTicket(local.workId, { requestId: REQUEST }, deps);

        expect(recovered.status).toBe(200);

        if (editorWrite) {
            expect(recovered.body.record?.title).toBe('Edited title');
            expect(handle.records.body(local.workId, 'brief')).toBe('Edited on tracker.');
            expect(handle.records.gate(local.workId).evidence.at(-1)?.source).toBe('tracker');
        } else {
            expect(recovered.body.record?.title).toBe('Fix export');
            expect(handle.records.body(local.workId, 'brief')).toBe('Gated Spec.');
            expect(handle.records.specState(local.workId)).toMatchObject({
                held: { body: remote.body, title: 'Edited title' },
                base: { version: stage === 'response' ? '' : '1', body: expect.stringContaining('Gated Spec.') },
            });
            expect(handle.records.gate(local.workId).evidence.at(-1)?.source).toBe('gate');
        }

        expect(creates).toBe(1);
    },
);

test('retention purges capture prose and retains replay protection', async () => {
    const { records, local, deps, writes } = await setup();
    const draft = {
        repo: REPO,
        kind: 'bug',
        title: 'Private title',
        description: 'Private description',
        createIssue: true,
    };
    const result = await captureWork({ requestId: REQUEST, draft }, deps);

    expect(records.captureSubmission(REQUEST)!.draft).toContain('Private description');

    const record = result.body.record!;

    records.setAside(record.workId, record.revision);
    expect(records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }).deleted).toContain(record.workId);
    expect(records.captureSubmission(REQUEST)).toMatchObject({
        draft: '',
        createdTicket: null,
        ticket: `${REPO}#13`,
    });
    expect((await captureWork({ requestId: REQUEST, draft }, deps)).status).toBe(409);
    expect(() =>
        records.completeCapture(REQUEST, { title: 'Replay', repository: REPO, kind: 'bug', ticket: `${REPO}#13` }),
    ).toThrow(/expired/i);
    expect(writes).toHaveLength(1);
    expect(records.list({}).map((record) => record.workId)).toEqual([local.workId]);
});

const NEW_LABEL_DRAFT = { repo: REPO, kind: 'bug', title: 'Fix export', description: 'Steps.', createIssue: true };

/** The setup, with label management allowed and the label operations recorded. */
async function withLabels() {
    const made = await setup();

    made.repo.setup!.access['manage-labels'] = 'allowed';

    const created: string[] = [];
    const deps = {
        ...made.deps,
        labels: () =>
            ({
                create: async ({ name }: { name: string }) => {
                    created.push(name);

                    return { name };
                },
            }) as unknown as TrackerLabels,
    };
    const capture = (labels: object) =>
        captureWork({ requestId: REQUEST, draft: { ...NEW_LABEL_DRAFT, options: labels } }, deps);

    return { ...made, deps, created, capture };
}

test('a new label is created when the ticket submits, and the ticket carries it', async () => {
    const { capture, created, writes } = await withLabels();

    expect((await capture({ labels: ['bug'], newLabels: ['needs-design'] })).status).toBe(200);
    expect(created).toEqual(['needs-design']);
    expect(writes[0]![5]).toEqual({ labels: ['bug', 'needs-design'], type: 'Bug' });
});

test('a new label without manage-labels is refused before anything is written', async () => {
    const { capture, repo, created, writes } = await withLabels();

    repo.setup!.access['manage-labels'] = 'refused';

    const refused = await capture({ newLabels: ['needs-design'] });

    expect(refused.status).toBe(403);
    expect(created).toEqual([]);
    expect(writes).toHaveLength(0);
});

test.each([false, true])(
    'agent ticket attachment preserves concurrent data and request identity; conflict=%s',
    async (conflicting) => {
        const { records, local, deps, writes } = await setup();
        const create = deps.provider.create.bind(deps.provider);

        deps.provider.create = async (...args) => {
            if (conflicting) records.update(local.workId, local.revision, { kind: 'feature' });
            else records.setNeedsYou(local.workId, local.revision, 'Concurrent note');

            return create(...args);
        };

        const agentDeps = { ...deps, records: agentWrites(records) };
        const input = { revision: local.revision, requestId: REQUEST };
        const result = await createAgentTicket(local.workId, input, agentDeps);

        expect(writes).toHaveLength(1);

        if (conflicting) {
            expect(result.body.error).toContain('conflicting fields: kind');
            expect(records.read(local.workId)).toMatchObject({ kind: 'feature', ticket: null });
        } else {
            expect(result.body.record).toMatchObject({
                workId: local.workId,
                ticket: `${REPO}#13`,
                needsYou: 'Concurrent note',
            });
            expect((await createAgentTicket(local.workId, input, agentDeps)).body.record?.workId).toBe(local.workId);
            expect(writes).toHaveLength(1);
        }
    },
);

test('S05-F4-003 the board’s exact freshly created Feature is not an unknown-provenance edit', async () => {
    const { records, deps, repo, writes } = await setup();
    const description = readFileSync(new URL('../test/briefs/s05-final4-description.txt', import.meta.url), 'utf8');
    const result = await captureWork(
        {
            requestId: SECOND,
            draft: { repo: REPO, kind: 'feature', title: 'Linked greeting', description, createIssue: true },
        },
        deps,
    );

    expect(result.status).toBe(200);

    const id = result.body.record!.workId;
    const created = writes.at(-1)!;
    const remote = { repository: REPO, number: 13, title: 'Linked greeting', body: String(created[2]), version: '1' };
    const provider = { ...deps.provider, readSpec: async () => remote };

    for (const body of [remote.body, remote.body.replace(/<!-- lar-factory:create [^\n]* -->/g, '').trimEnd() + '\n']) {
        remote.body = body;
        await refreshSpecs(records, { workId: id, provider, setups: [repo.setup!] });
        expect(records.specState(id).held).toBeNull();
        expect(records.specState(id).warning).toBeNull();
    }
    remote.body += '\nExternal scope change';
    await refreshSpecs(records, { workId: id, provider, setups: [repo.setup!] });
    expect(records.specState(id).held).not.toBeNull();
    expect(records.initialContext(id)).toBe(description.trim());
});
