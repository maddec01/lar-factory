import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'vite-plus/test';

const execute = promisify(execFile);

test('a fresh process cannot invoke providers or access sentinel application data while exercising the core', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'lar-fake-tracker-'));

    t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

    const home = join(directory, 'home');
    const data = join(home, 'Library/Application Support/Lar Factory');
    const bin = join(directory, 'bin');
    const log = join(directory, 'provider-calls');

    await mkdir(data, { recursive: true });
    await mkdir(bin);
    await writeFile(join(data, 'sentinel'), 'real data must remain untouched');
    await writeFile(log, '');

    for (const name of ['gh', 'az', 't3'])
        await writeFile(join(bin, name), '#!/bin/sh\necho "$0 $*" >> "$FAKE_PROVIDER_LOG"\nexit 91\n', { mode: 0o755 });

    // Hooks make reads observable too: an unchanged sentinel alone would only prove there were no writes.
    const guard = `
        import fs from 'node:fs';
        import promises from 'node:fs/promises';
        import childProcess from 'node:child_process';
        import { syncBuiltinESMExports, registerHooks } from 'node:module';
        import { resolve } from 'node:path';
        import { fileURLToPath } from 'node:url';
        const forbidden = ${JSON.stringify(data)};
        const touches = [];
        const calls = [];
        const inspect = (value) => {
            if (typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return;
            const path = resolve(value instanceof URL ? fileURLToPath(value) : String(value));
            if (path === forbidden || path.startsWith(forbidden + '/')) {
                touches.push(path);
                throw new Error('sentinel data access: ' + path);
            }
        };
        for (const object of [fs, promises]) {
            for (const name of ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'open', 'openSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'access', 'accessSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rename', 'renameSync', 'appendFile', 'appendFileSync', 'existsSync', 'createReadStream', 'createWriteStream']) {
                if (typeof object[name] !== 'function') continue;
                const original = object[name];
                object[name] = (...args) => { args.forEach(inspect); return original(...args); };
            }
        }
        for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
            childProcess[name] = (...args) => { calls.push([name, args[0]]); throw new Error('provider process refused'); };
        }
        syncBuiltinESMExports();
        registerHooks({ load(url, context, next) { if (url.startsWith('file:')) inspect(new URL(url)); return next(url, context); } });
        const { createFakeTracker } = await import(${JSON.stringify(new URL('./fake-tracker.ts', import.meta.url).href)});
        const { fakeItemSource } = await import(${JSON.stringify(new URL('./fake-item-source.ts', import.meta.url).href)});
        const tracker = createFakeTracker({ mode: 'sample' });
        const [repo, other] = tracker.repositories().map(config => config.repo);
        const draft = { identity: 'process', title: 'Process test', body: 'Body', kind: 'concept' };
        const first = await tracker.create(repo, draft);
        const child = await tracker.create(other, { ...draft, kind: 'build' });
        const from = { repo, number: first.item.number };
        const to = { repo: other, number: child.item.number };
        const labels = tracker.labels(repo);
        await labels.list();
        await labels.create({ name: 'process' });
        await labels.addToTicket(from.number, ['process']);
        await labels.update('process', { name: 'renamed' });
        await labels.removeFromTicket(from.number, ['renamed']);
        await labels.delete('renamed');
        await tracker.kinds(repo).setType(from.number, 'Feature');
        await tracker.kinds(repo).read(from.number);
        await tracker.kinds(repo).boardTypes();
        await tracker.edit(repo, from.number, { body: 'Saved' });
        await tracker.setParent(to, from);
        await tracker.setLink(to, from, 'blocked-by');
        await tracker.setLink(from, to, 'related');
        await tracker.read(repo, from.number);
        const source = fakeItemSource(tracker, repo);
        await source.read();
        await source.readTicket(repo, from.number);
        await source.searchTickets(repo, 'Process');
        await source.observeTicket(repo, from.number);
        tracker.failures.set('issues.read', { fail: 'next', latencyMs: 1 });
        await source.readTicket(repo, from.number).then(() => { throw new Error('expected read refusal'); }, () => {});
        if ((await tracker.create(repo, draft)).item.id !== first.item.id) throw new Error('duplicate retry');
        let refused = false;
        try { await tracker.create('maddec01/lar-server', draft); } catch { refused = true; }
        if (!refused) throw new Error('real repository accepted');
        await source.abandon(first.item);
        tracker.reset();
        console.log(JSON.stringify({ touches, calls, result: 'isolated' }));
    `;
    const result = await execute(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', guard],
        {
            env: {
                ...process.env,
                HOME: home,
                LAR_FACTORY_DATA_DIR: data,
                PATH: `${bin}:${process.env.PATH}`,
                FAKE_PROVIDER_LOG: log,
            },
            timeout: 20_000,
        },
    );

    assert.deepEqual(JSON.parse(result.stdout), { touches: [], calls: [], result: 'isolated' });
    assert.equal(await readFile(log, 'utf8'), '');
    assert.deepEqual(await readdir(data), ['sentinel']);
    assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'real data must remain untouched');
});
