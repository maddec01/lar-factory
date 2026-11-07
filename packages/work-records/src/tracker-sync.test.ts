import {
    readTrackerStructure,
    writeTrackerStructure,
    type TrackerStructure,
    type RepositorySetup,
} from '@lar-factory/shared';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { trackerCache, trackerDigest } from './tracker-cache.ts';
import {
    readStructureSnapshot,
    syncStructures,
    structureProvider,
    type StructureProvider,
    type StructureTicket,
} from './tracker-sync.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const handles: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const { records, dir } of handles.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function cache() {
    const dir = mkdtempSync(join(tmpdir(), 'structure-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    handles.push({ records, dir });

    return records;
}

const settings = (repo: string, structureSync = true): RepositorySetup =>
    ({
        repo,
        structureSync,
        access: {
            'publish-ticket': 'allowed',
            'edit-ticket': 'allowed',
            'comment-ticket': 'allowed',
            'tag-ticket': 'allowed',
        },
        vocabulary: {},
    }) as unknown as RepositorySetup;

function fakeProvider() {
    const issues = new Map<string, StructureTicket>();
    const comments = new Map<string, string>();
    const writes: string[] = [];
    let counter = 100;
    let commentCount = 1000;
    let failComment = 0;
    const key = (repo: string, number: number) => `${repo}#${number}`;
    const put = (repository: string, number: number, body = 'Author text.\n') => {
        issues.set(key(repository, number), { repository, number, body, version: '1' });
    };
    const read = async (repository: string, number: number) => {
        const ticket = issues.get(key(repository, number));

        if (!ticket) throw Error('No issue.');

        return { ...ticket };
    };
    const provider: StructureProvider = {
        read,
        find: async (repo, id) =>
            [...issues.values()].filter(
                (issue) => issue.repository === repo && readTrackerStructure(issue.body)?.identity === id,
            ),
        create: async (repo, title, body) => {
            writes.push(`create ${repo} ${title}`);
            put(repo, ++counter, body);

            return read(repo, counter);
        },
        comment: async (ticket, body) => {
            writes.push('comment');

            if (failComment && --failComment === 0) throw Error('Comment unavailable.');

            const id = String(++commentCount);

            comments.set(id, body);

            return id;
        },
        readComment: async (_ticket, id) => {
            const body = comments.get(id);

            if (!body) throw Error('No comment.');

            return body;
        },
        replace: async (ticket, body) => {
            const current = await read(ticket.repository, ticket.number);

            if (current.version !== ticket.version) throw Error('Issue changed.');

            writes.push(`replace ${key(ticket.repository, ticket.number)}`);
            issues.set(key(ticket.repository, ticket.number), {
                ...ticket,
                body,
                version: String(Number(ticket.version) + 1),
            });
        },
    };

    put('team/relay', 6, 'Relay author text.');

    return {
        provider,
        issues,
        comments,
        writes,
        put,
        failComment: (n: number) => {
            failComment = n;
        },
    };
}

const MAP =
    '## Destination\nWatch anywhere.\n\n## Decisions so far\n- Use a shared contract.\n\n## Fog\n- none\n\n## Domain docs\n- PRIVATE DOMAIN DRAFT\n\n## Map\n```mermaid\nflowchart LR\n A[Server] --> B[Apple]\n```\n';

async function concept(records: WorkRecords) {
    let root = records.create({
        repository: 'team/server',
        title: 'Watch anywhere',
        kind: 'concept',
        ticket: 'team/server#42',
    });

    root = records.setBody(root.workId, root.revision, 'map', MAP);

    let decision = records.create({ repository: 'team/server', title: 'Choose contract', kind: 'decision' });

    decision = records.setParent(decision.workId, decision.revision, root.workId);
    decision = records.setBody(decision.workId, decision.revision, 'decision', 'PRIVATE DECISION');
    decision = records.setBody(decision.workId, decision.revision, 'answer', 'PRIVATE ANSWER');

    let build = records.create({ repository: 'team/apple', title: 'Play media', kind: 'build' });

    build = records.setParent(build.workId, build.revision, root.workId);
    build = records.setBody(build.workId, build.revision, 'brief', 'PRIVATE BRIEF');
    build = records.update(build.workId, build.revision, { status: 'Queued' });

    let slice = records.create({ repository: 'team/apple', title: 'PRIVATE SLICE', kind: 'slice' });

    slice = records.setParent(slice.workId, slice.revision, build.workId);

    const dependency = records.addDependency(root.workId, {
        need: 'Relay contract',
        owner: 'team/relay',
        ticket: 'team/relay#6',
        contract: 'Stream URL',
        evidence: 'Version 1',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);

    return { root, build, decision, slice };
}

test('GitHub structural commits append comments, preserve interleaved author edits, find older managed comments and reject forks', async () => {
    const records = await cache();
    const dir = handles.at(-1)!.dir;
    const state = join(dir, 'github.json');
    const fake = join(dir, 'gh.mjs');

    writeFileSync(
        state,
        JSON.stringify({ body: 'Author original.', labels: [], comments: [], writes: [], next: 100, interleave: true }),
    );
    writeFileSync(
        fake,
        `#!/usr/bin/env node
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const args=process.argv.slice(2),stateFile=${JSON.stringify(state)},state=JSON.parse(readFileSync(stateFile,'utf8'));
const path=args.find(arg=>arg.startsWith('repos/')),method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET';
const payload=args.includes('--input')?JSON.parse(readFileSync(0,'utf8')):undefined;
const emit=value=>process.stdout.write(JSON.stringify(value)),save=()=>{const next=stateFile+'.'+process.pid;writeFileSync(next,JSON.stringify(state));renameSync(next,stateFile);};
if(method!=='GET')state.writes.push({path,method,payload});
if(method==='PATCH')throw Error('Structural writes must never PATCH authored issue bodies');
if(path.endsWith('/labels/linked-work'))emit({name:'linked-work'});
else if(path.endsWith('/issues/1/labels')){state.labels=[{name:'linked-work'}];save();emit(state.labels);}
else if(path.includes('/issues/1/comments?')){
 const page=Number(new URL('https://fixture/'+path).searchParams.get('page')||1),value=state.comments.slice((page-1)*100,page*100);
 if(args.includes('-i'))process.stdout.write('HTTP/2.0 200 OK\\r\\nETag: "fixture-'+state.comments.length+'-'+page+'"\\r\\n\\r\\n');emit(value);
}else if(path.endsWith('/issues/1/comments')){
 if(state.interleave){state.body='Author edited between the structure read and append.';state.interleave=false;}
 const id=String(++state.next);state.comments.push({id,body:payload.body});save();emit({id});
}else if(path.endsWith('/issues/1'))emit({number:1,html_url:'https://github.com/team/server/issues/1',body:state.body,labels:state.labels,comments:state.comments.length,updated_at:String(state.comments.length)});
else throw Error('Unexpected fake GitHub call '+JSON.stringify(args));
if(method!=='GET')save();
`,
        { mode: 0o755 },
    );
    vi.stubEnv('GH_PATH', fake);

    const provider = structureProvider();
    const ticket = await provider.read('team/server', 1);
    const { writeTrackerStructure } = await import('@lar-factory/shared');
    const base = {
        version: 1 as const,
        kind: 'concept' as const,
        identity: '11111111-1111-4111-8111-111111111111',
        repository: 'team/server',
    };

    await provider.replace(ticket, writeTrackerStructure(ticket.body, base));

    let fixture = JSON.parse(readFileSync(state, 'utf8'));

    expect(fixture.body).toBe('Author edited between the structure read and append.');
    expect(fixture.writes.some((write: { method: string }) => write.method === 'PATCH')).toBe(false);
    // More than a page of ordinary discussion must not hide the latest saved structural projection.
    fixture.comments.push(
        ...Array.from({ length: 120 }, (_, index) => ({ id: String(500 + index), body: `Ordinary comment ${index}` })),
    );
    writeFileSync(state, JSON.stringify(fixture));

    const found = await provider.read('team/server', 1);

    expect(readTrackerStructure(found.body)).toMatchObject(base);

    const manifest = {
        root: 'https://github.com/team/server/issues/1',
        repository: 'team/server',
        generation: '22222222-2222-4222-8222-222222222222',
        digest: 'a'.repeat(64),
        previous: null,
        chunks: [{ id: '4', digest: 'd'.repeat(64) }],
    };

    fixture = JSON.parse(readFileSync(state, 'utf8'));
    fixture.comments.push({ id: '800', body: writeTrackerStructure('', { ...base, snapshot: manifest }).trim() });
    fixture.comments.push({
        id: '801',
        body: writeTrackerStructure('', { ...base, snapshot: { ...manifest, digest: 'b'.repeat(64) } }).trim(),
    });
    writeFileSync(state, JSON.stringify(fixture));
    await expect(provider.read('team/server', 1)).rejects.toThrow('concurrent tracker versions');
}, 30_000);

test('Azure dependency PR references retain their repository URL and round trip separately from work items', async () => {
    const records = await cache();
    const root = records.create({
        repository: 'org/Project/server',
        kind: 'concept',
        title: 'Playback',
        ticket: 'org/Project/server#1',
    });

    records.addDependency(root.workId, {
        need: 'Relay endpoint',
        owner: 'org/Project/relay',
        ticket: 'org/Project/relay#6',
        pullRequests: ['org/Project/relay#7'],
    });

    const snapshot = records.trackerSnapshot(root.workId);

    expect(snapshot.dependencies[0]?.ticket).toBe('https://dev.azure.com/org/Project/_workitems/edit/6');
    expect(snapshot.dependencies[0]?.pullRequests).toEqual([
        'https://dev.azure.com/org/Project/_git/relay/pullrequest/7',
    ]);

    const fresh = await cache();
    const restored = fresh.trackerRestore(snapshot, 'a'.repeat(64));

    expect(fresh.dependencies(restored)[0]?.pullRequests).toEqual(['org/Project/relay#7']);
});

test('untrusted snapshot shape and repository mismatches fail before any context reads or import writes', async () => {
    const { gzipSync } = await import('node:zlib');
    const { createHash } = await import('node:crypto');
    const { writeTrackerStructure } = await import('@lar-factory/shared');
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    const identity = '11111111-1111-4111-8111-111111111111';
    const generation = '22222222-2222-4222-8222-222222222222';
    const valid = {
        version: 1,
        root: identity,
        nodes: [
            {
                key: identity,
                repository: 'team/server',
                ticket: 'team/server#1',
                kind: 'concept',
                title: 'Concept',
                parent: null,
                blockers: [],
            },
        ],
        dependencies: [],
    };

    for (const payload of [
        { ...valid, nodes: [null] },
        { ...valid, nodes: [{ ...valid.nodes[0], ticket: 'unrelated/secret#1' }] },
        { ...valid, nodes: Array.from({ length: 1001 }, () => valid.nodes[0]) },
        { ...valid, nodes: [{ ...valid.nodes[0], brief: 'PRIVATE ORDINARY BRIEF' }] },
    ]) {
        const raw = JSON.stringify(payload);
        const encoded = gzipSync(raw).toString('base64');
        let contextReads = 0;
        const metadata = {
            version: 1 as const,
            kind: 'concept' as const,
            snapshot: {
                root: 'https://github.com/team/server/issues/1',
                repository: 'team/server',
                generation,
                digest: digest(raw),
                chunks: [{ id: '5', digest: digest(encoded) }],
            },
        };
        const ticket = {
            repository: 'team/server',
            number: 1,
            version: '1',
            body: writeTrackerStructure('', metadata),
        };
        const provider = {
            read: async () => {
                contextReads++;
                throw Error('Unexpected authenticated context read');
            },
            readComment: async () => `<!-- lar-factory:chunk ${generation} 0\n${encoded}\n-->`,
        } as unknown as StructureProvider;
        const fresh = await cache();

        await expect(
            readStructureSnapshot(ticket, metadata, provider, [settings('team/server')]).then((saved) => {
                return Promise.all(saved.snapshot.nodes.map((node) => provider.read(node.repository, 1))).then(() =>
                    fresh.trackerRestore(saved.snapshot, saved.digest),
                );
            }),
        ).rejects.toThrow();
        expect(contextReads).toBe(0);
        expect(fresh.list({})).toEqual([]);
    }
});

test('a stale failure checkpoint cannot overwrite a later structural outbox entry', async () => {
    const records = await cache();
    const root = records.create({
        repository: 'team/server',
        kind: 'concept',
        title: 'Concept',
        ticket: 'team/server#42',
    });
    const digest = trackerDigest(records.trackerSnapshot(root.workId));

    records.setBody(root.workId, root.revision, 'map', '## Destination\nLater map');
    records.trackerFailed(root.workId, 'An obsolete request failed.', true, digest);
    expect(records.trackerState(root.workId)).toEqual({ state: 'pending' });
    expect(records.trackerCheckpoint(root.workId).error).toBeNull();
});

test('one refresh reads the tracker graph once, and each record keeps the state it has alone', async () => {
    const records = await cache();
    const { dir } = handles.at(-1)!;
    const { root, decision, build } = await concept(records);
    const lone = ['team/server#50', 'team/server#51', 'team/server#52'].map((ticket) =>
        records.create({ repository: 'team/server', kind: 'build', title: ticket, ticket }),
    );
    const failed = records.create({
        repository: 'team/server',
        kind: 'concept',
        title: 'Failed',
        ticket: 'team/server#60',
    });

    records.trackerFailed(failed.workId, 'The tracker refused.', true);

    const { openDatabase } = await import('./database.ts');
    const database = await openDatabase(join(dir, 'work-records.db'));
    const graphReads = vi.fn();
    const prepare = database.db.prepare.bind(database.db);

    database.db.prepare = ((sql: string) => {
        if (sql.includes("FROM work_records WHERE kind <> 'slice'")) graphReads();

        return prepare(sql);
    }) as typeof database.db.prepare;

    const stateOf = trackerCache(database).trackerStates();
    const expected: [string, unknown][] = [
        [root.workId, { state: 'pending' }],
        [decision.workId, { state: 'pending' }],
        [build.workId, { state: 'pending' }],
        ...lone.map(({ workId }): [string, unknown] => [workId, undefined]),
        [failed.workId, { state: 'conflict', message: 'The tracker refused.' }],
    ];

    for (const [workId, state] of expected) {
        expect(stateOf(workId)).toEqual(state);
        expect(records.trackerState(workId)).toEqual(state);
    }
    expect(graphReads).toHaveBeenCalledTimes(1);
    database.close();
});

test('the existing create transport sends GitHub options and Azure Bug HTML with tags, identity, iteration and default area', async () => {
    await cache();

    const dir = handles.at(-1)!.dir;
    const cli = join(dir, 'provider.mjs');

    writeFileSync(
        cli,
        `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const args=process.argv.slice(2), value=flag=>args[args.indexOf(flag)+1];
if(args[0]==='api') {
 const input=JSON.parse(readFileSync(0,'utf8'));
 assert.equal(value('--method'),'POST');
 assert.deepEqual(input,{title:'Failure',body:'## Steps',labels:['backend'],type:'Bug',assignees:['writer'],milestone:12});
 process.stdout.write(JSON.stringify({number:8,title:input.title,body:input.body,updated_at:'1'}));
} else {
 assert.equal(value('--http-method'),'POST');
 const patch=JSON.parse(readFileSync(value('--in-file'),'utf8'));
 const fields=Object.fromEntries(patch.map(op=>[op.path.slice('/fields/'.length),op.value]));
 assert.equal(fields['System.Title'],'Failure');
 assert.equal(fields['System.Description'],undefined);
 assert.equal(fields['System.Tags'],'backend; triage');
 assert.equal(fields['System.AssignedTo'],'writer@example.test');
 assert.equal(fields['System.IterationPath'],'Project\\\\Sprint');
 assert.equal(fields['System.AreaPath'],'Project\\\\Team');
 assert.match(fields['Microsoft.VSTS.TCM.ReproSteps'],/<h2>Steps<\\/h2>/);
 assert.match(fields['Microsoft.VSTS.TCM.ReproSteps'],/<!-- lar-factory:create/);
 process.stdout.write(JSON.stringify({id:9,rev:1,fields:{...fields,'System.WorkItemType':'Bug'}}));
}
`,
        { mode: 0o755 },
    );
    vi.stubEnv('GH_PATH', cli);
    vi.stubEnv('AZ_PATH', cli);
    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '');

    const provider = structureProvider();

    expect(
        (
            await provider.create('example/source', 'Failure', '## Steps', 'Bug', undefined, {
                labels: ['backend'],
                assignee: 'writer',
                milestone: '12',
            })
        ).number,
    ).toBe(8);

    const bug = await provider.create(
        'example/Project/source',
        'Failure',
        '## Steps\n\n<!-- lar-factory:create {"identity":"request"} -->',
        'Bug',
        'Project\\Team',
        { labels: ['backend', 'triage'], assignee: 'writer@example.test', iteration: 'Project\\Sprint' },
    );

    expect(bug.body).toContain('<h2>Steps</h2>');
    expect(bug.number).toBe(9);
});

test('suspension retains pending work and uncertain creation across explicit retries and setting variants', async () => {
    const records = await cache();
    const { root, decision } = await concept(records);

    records.trackerReserveCreation(decision.workId);

    const before = records.trackerPending();
    const checkpoint = records.trackerCheckpoint(root.workId);
    const fake = fakeProvider();

    for (const structureSync of [undefined, false, true]) {
        await syncStructures(records, {
            provider: fake.provider,
            setups: [{ ...settings('team/server'), structureSync } as RepositorySetup],
            workId: root.workId,
            confirmedMissingIssue: decision.workId,
        });
    }
    expect(fake.writes).toEqual([]);
    expect(records.trackerPending()).toEqual(before);
    expect(records.trackerCheckpoint(root.workId)).toEqual(checkpoint);
    expect(records.trackerReserveCreation(decision.workId)).toBe(false);
});

test('legacy upgrade preserves every stored row and repeats without changing pending identities', async () => {
    const records = await cache();
    const { root, decision } = await concept(records);
    const finished = records.create({ repository: 'team/apple', title: 'Completed earlier build', kind: 'build' });

    records.setBody(finished.workId, finished.revision, 'brief', 'Retained finished history');
    records.recordFinished(finished.workId, records.read(finished.workId).revision);
    records.trackerReserveCreation(decision.workId);
    records.trackerFailed(root.workId, 'Retained conflict', true, 'local-digest');

    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('./migrations.ts');
    const { openDatabase } = await import('./database.ts');
    const path = records.trackerDatabasePath();
    const raw = new DatabaseSync(path);

    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length - 1}`);

    const rows = () =>
        raw
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map(({ name }) => [name, raw.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()]);
    const before = JSON.stringify(rows());

    for (let attempt = 0; attempt < 2; attempt++) {
        const upgraded = await openDatabase(path);

        expect(JSON.stringify(rows())).toBe(before);
        upgraded.close();
    }
    raw.close();
});

test('legacy snapshot chunks still recover without structural publication', async () => {
    const { gzipSync } = await import('node:zlib');
    const { createHash } = await import('node:crypto');
    const records = await cache();
    const root = records.create({
        repository: 'team/server',
        title: 'Legacy concept',
        kind: 'concept',
        ticket: 'team/server#42',
    });
    const snapshot = records.trackerSnapshot(root.workId);
    const payload = JSON.stringify(snapshot);
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    const data = gzipSync(payload).toString('base64');
    const fake = fakeProvider();

    fake.put('team/server', 42);
    fake.comments.set('123', `<!-- lar-factory:chunk 11111111-1111-1111-1111-111111111111 0\n${data}\n-->`);

    const ticket = await fake.provider.read('team/server', 42);
    const metadata: TrackerStructure = {
        version: 1,
        kind: 'concept',
        identity: root.workId,
        snapshot: {
            root: 'https://github.com/team/server/issues/42',
            repository: 'team/server',
            generation: '11111111-1111-1111-1111-111111111111',
            digest: digest(payload),
            previous: null,
            chunks: [{ id: '123', digest: digest(data) }],
        },
    };

    ticket.body = writeTrackerStructure('', metadata);

    const recovered = await readStructureSnapshot(ticket, metadata, fake.provider, [settings('team/server')]);

    expect(recovered.snapshot).toEqual(snapshot);
    expect(fake.writes).toEqual([]);
});
