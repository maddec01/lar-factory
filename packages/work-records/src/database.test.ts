import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { openDatabase, type Migration } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-records-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        chmodSync(dir, 0o700);
        rmSync(dir, { recursive: true, force: true });
    }
});

const pragma = (db: DatabaseSync, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];

// A schema with a notes table, so tests can tell committed rows from lost ones.
const NOTES: Migration = (db) => db.exec('CREATE TABLE notes (text TEXT NOT NULL)');
const noteTexts = (db: DatabaseSync) =>
    db
        .prepare('SELECT text FROM notes ORDER BY rowid')
        .all()
        .map((r) => r.text);

describe('openDatabase', () => {
    it('reads one state through a snapshot across turns of the event loop, while another connection commits', async () => {
        const path = join(tempDir(), 'work-records.db');
        const database = await openDatabase(path, { migrations: [NOTES] });
        const other = new DatabaseSync(path);

        try {
            other.prepare('INSERT INTO notes VALUES (?)').run('before');

            const reads = await database.snapshot(async () => {
                const first = database.read(() => noteTexts(database.db));

                await new Promise((resolve) => setImmediate(resolve));
                other.prepare('INSERT INTO notes VALUES (?)').run('during');
                await new Promise((resolve) => setImmediate(resolve));

                return [first, database.read(() => noteTexts(database.db))];
            });

            expect(reads).toEqual([['before'], ['before']]);
            expect(database.read(() => noteTexts(database.db))).toEqual(['before', 'during']);
            await expect(
                database.snapshot(async () => {
                    throw new Error('no');
                }),
            ).rejects.toThrow('no');
            expect(database.db.isTransaction).toBe(false);
        } finally {
            other.close();
            database.close();
        }
    });

    it('keeps the database and its WAL files readable by their owner only', async () => {
        const dir = tempDir();
        const path = join(dir, 'work-records.db');
        const files = [path, `${path}-wal`, `${path}-shm`];
        const modes = () => files.map((file) => statSync(file).mode & 0o777);
        const fresh = await openDatabase(path, { migrations: [NOTES] });

        fresh.write(() => fresh.db.exec("INSERT INTO notes VALUES ('one')"));
        expect(modes()).toEqual([0o600, 0o600, 0o600]);

        for (const file of files) chmodSync(file, 0o644);

        const reopened = await openDatabase(path, { migrations: [NOTES] });

        try {
            expect(modes()).toEqual([0o600, 0o600, 0o600]);
        } finally {
            reopened.close();
            fresh.close();
        }
    });

    it('keeps every committed record and removes its copy when a schema update fails', async () => {
        const dir = tempDir();
        const path = join(dir, 'work-records.db');
        const first = await openDatabase(path, { migrations: [NOTES] });

        // Committed rows stay in the WAL while this connection is open and never checkpoints.
        first.db.exec('PRAGMA wal_autocheckpoint = 0');
        first.write(() => first.db.exec("INSERT INTO notes VALUES ('one'), ('two')"));
        expect(readdirSync(dir)).toContain('work-records.db-wal');

        const failing: Migration = (db) => {
            db.exec('DELETE FROM notes; CREATE TABLE half (x)');
            throw new Error('disk full');
        };

        await expect(openDatabase(path, { migrations: [NOTES, failing] })).rejects.toThrow(
            /schema update to version 2 failed: disk full/,
        );
        first.close();

        const reopened = await openDatabase(path, { migrations: [NOTES] });

        try {
            expect(noteTexts(reopened.db)).toEqual(['one', 'two']);
            expect(pragma(reopened.db, 'user_version')).toBe(1);
        } finally {
            reopened.close();
        }

        expect(readdirSync(dir).filter((f) => /\.before-v/.test(f))).toEqual([]);
    });

    it('refuses writes once another process updates the schema past what it knows', async () => {
        const path = join(tempDir(), 'work-records.db');
        const old = await openDatabase(path, { migrations: [NOTES] });

        try {
            (await openDatabase(path, { migrations: [NOTES, (db) => db.exec('CREATE TABLE more (x)')] })).close();
            expect(() => old.write(() => old.db.exec("INSERT INTO notes VALUES ('x')"))).toThrow(
                expect.objectContaining({ code: 'schema-too-new' }),
            );
        } finally {
            old.close();
        }
    });
});

it('upgrading purges orphaned capture drafts without dropping their replay tombstones', async () => {
    const path = join(tempDir(), 'records.db');
    // Schema 14 predates the orphaned-capture purge; later migrations must not move this fixture.
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 14) });

    old.db
        .prepare('INSERT INTO capture_submissions(request_id,draft,ticket,work_id,target_work_id) VALUES (?,?,?,?,?)')
        .run('capture', 'Private capture description', 'example/product#1', 'deleted-capture', null);
    old.db
        .prepare('INSERT INTO capture_submissions(request_id,draft,ticket,work_id,target_work_id) VALUES (?,?,?,?,?)')
        .run('conversion', 'Private conversion Spec', 'example/product#2', null, 'deleted-conversion');
    old.db
        .prepare('INSERT INTO capture_submissions(request_id,draft) VALUES (?,?)')
        .run('pending', 'Pending description');
    old.close();

    const updated = await openDatabase(path);

    try {
        expect(
            updated.db
                .prepare('SELECT request_id,draft,ticket FROM capture_submissions ORDER BY request_id')
                .all()
                .map((row) => ({ ...row })),
        ).toEqual([
            { request_id: 'capture', draft: '', ticket: 'example/product#1' },
            { request_id: 'conversion', draft: '', ticket: 'example/product#2' },
            { request_id: 'pending', draft: 'Pending description', ticket: null },
        ]);
    } finally {
        updated.close();
    }
});

it('refuses an upgrade while a structural writer owns the lease', async () => {
    const path = join(tempDir(), 'work-records.db');
    const old = await openDatabase(path, { migrations: [NOTES] });

    old.write(() => old.db.exec("INSERT INTO notes VALUES ('pending identity')"));

    const { acquireTrackerSyncLock } = await import('./tracker-lock.ts');
    const lease = await acquireTrackerSyncLock(path);

    try {
        await expect(openDatabase(path, { migrations: [NOTES, () => {}] })).rejects.toThrow(/Restart/);
        expect(noteTexts(old.db)).toEqual(['pending identity']);
    } finally {
        await lease!.release();
    }

    const upgraded = await openDatabase(path, { migrations: [NOTES, () => {}] });

    expect(noteTexts(upgraded.db)).toEqual(['pending identity']);
    expect(() => old.read(() => null)).toThrow(/newer/);
    upgraded.close();
    old.close();
});

it('nested mutations use savepoints and never expose or commit a partial group', async () => {
    const path = join(tempDir(), 'nested-group.db');
    const database = await openDatabase(path, { migrations: [NOTES] });
    const observer = new DatabaseSync(path);

    try {
        const before = database.changes();

        expect(() =>
            database.write(() => {
                database.write(() => database.db.prepare('INSERT INTO notes VALUES (?)').run('first'));
                expect(noteTexts(observer)).toEqual([]);
                expect(database.changes()).toBe(before);
                expect(() =>
                    database.write(() => {
                        database.db.prepare('INSERT INTO notes VALUES (?)').run('second');
                        throw new Error('refused nested part');
                    }),
                ).toThrow('refused nested part');
                expect(noteTexts(database.db)).toEqual(['first']);
                throw new Error('refused whole group');
            }),
        ).toThrow('refused whole group');
        expect(noteTexts(observer)).toEqual([]);
        expect(database.changes()).toBe(before);
    } finally {
        observer.close();
        database.close();
    }
});
