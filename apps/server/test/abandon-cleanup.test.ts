// Abandon's cleanup on real Git refs: T3's live bindings and the PR host are the only stand-ins.

import type { BoardData, Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { createBoardState } from '../src/board/board-state.ts';
import { prHost } from '../src/config/pr-host.ts';
import { createItemCommands } from '../src/items/item-commands.ts';
import type { ItemSource } from '../src/items/item-source.ts';
import { archivedItems, recordItems } from '../src/items/record-items.ts';
import type { CleanupPlan } from '../src/items/work-cleanup.ts';

vi.mock('../src/t3/item-execution.ts', async (original) => ({
    ...(await original<object>()),
    liveWorktreePaths: () => [],
}));
vi.mock('../src/config/pr-host.ts', async (original) => ({ ...(await original<object>()), prHost: vi.fn() }));

const REPO = 'owner/repo';
const BRANCH = 'feat/old-build';

let dir: string;
let records: WorkRecords;
const deleteRemoteBranch = vi.fn(async () => {});

const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });

beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'abandon-cleanup-')));
    records = await openWorkRecords(join(dir, 'work-records.db'));
    deleteRemoteBranch.mockReset();
    deleteRemoteBranch.mockResolvedValue(undefined);
    vi.mocked(prHost).mockReturnValue({
        branchExists: async () => true,
        openPrByHead: async () => null,
        deleteRemoteBranch,
    } as unknown as ReturnType<typeof prHost>);
});
afterEach(() => {
    records.close();
    rmSync(dir, { recursive: true, force: true });
});

/** A checkout with the build's branch and a slice branch, both pushed to its origin and neither checked out. */
function checkoutWithBranches(sliceBranch: string): string {
    const origin = join(dir, 'origin.git');
    const checkout = join(dir, 'checkout');
    execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'pipe' });
    execFileSync('git', ['init', '-b', 'main', checkout], { stdio: 'pipe' });
    git(checkout, 'remote', 'add', 'origin', origin);
    git(checkout, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'first');
    git(checkout, 'push', '-u', 'origin', 'main');
    for (const branch of [BRANCH, sliceBranch]) {
        git(checkout, 'branch', branch);
        git(checkout, 'push', '-u', 'origin', branch);
    }
    return checkout;
}

/** A started build whose ticket and unmerged PR both closed, with a slice, on a board and in Archive as `records` say. */
function closedBuild(
    ticket: 'open' | 'closed' = 'closed',
    projectOf: () => Promise<{ projectId: string } | { error: string }> = async () => ({ projectId: 'project' }),
) {
    const build = records.create({ title: 'Closed build', repository: REPO, kind: 'build', status: 'Review' });
    const slice = records.create({ title: 'Slice', repository: REPO, kind: 'slice', status: 'Done' });
    records.setParent(slice.workId, slice.revision, build.workId);
    let record = records.setBuildBranch(build.workId, records.read(build.workId).revision, BRANCH);
    record = records.addThread(build.workId, record.revision, 'build-thread', 'build');
    record = records.setPullRequest(build.workId, record.revision, `${REPO}#40`);
    record = records.observe(build.workId, record.revision, { of: 'pr', state: 'closed' });
    record = records.attachTicket(build.workId, record.revision, `${REPO}#7`);
    record = records.observe(build.workId, record.revision, { of: 'ticket', state: ticket });
    records.setNeedsYouCauses(build.workId, record.revision, [
        { type: 'pr-closed' },
        ...(ticket === 'closed' ? [{ type: 'ticket-closed' } as const] : []),
    ]);
    const sliceBranch = `slice/${slice.workId.slice(0, 8)}-part`;
    const checkout = checkoutWithBranches(sliceBranch);
    const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
    const reread = () => board.update({ items: recordItems(records, [], [REPO]) });
    reread();
    const closes: number[] = [];
    const source = {
        observeTicket: async () => ({ state: ticket }),
        abandon: async (item: Item) => {
            closes.push(item.number!);
            return null;
        },
    } as unknown as ItemSource;
    const commands = createItemCommands({
        factoryContext: null,
        checkoutOf: async () => checkout,
        board,
        items: source,
        records,
        reread,
        offerModelChoices: () => [],
        archive: () => archivedItems(records, [], [REPO], new Set()),
        projectOf: projectOf as never,
        baseOf: async () => 'main',
        buildAccessOf: () => ({ 'push-branch': 'allowed' }),
    });
    return { workId: build.workId, sliceBranch, checkout, board, commands, closes };
}

interface Inspected {
    token: string;
    plans: CleanupPlan[];
}
const refs = (checkout: string) =>
    git(checkout, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').trim().split('\n');

test("inspecting and cancelling a notice's cleanup write nothing, and it plans the branch before its slices", async () => {
    const { workId, sliceBranch, commands, board } = closedBuild();
    const before = records.read(workId).revision;
    const reply = await commands.inspectOwnedCleanup(workId);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(
        (reply.body as Inspected).plans.map((plan) => plan.branch),
        [BRANCH, sliceBranch],
    );
    assert.deepEqual(records.cleanupOwnership(workId), []);
    assert.equal(records.read(workId).revision, before);
    assert.ok(board.find(workId)?.needsYou);
});

/** A build with a closed ticket's notice, on a board that counts its project reads. */
function noticedBuild(checkout: string) {
    const build = records.create({ title: 'Noticed', repository: REPO, kind: 'build', status: 'Ready' });
    records.setNeedsYouCauses(build.workId, build.revision, [{ type: 'ticket-closed' }]);
    const projectOf = vi.fn(async () => ({ projectId: 'project' }));
    const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
    const reread = () => board.update({ items: recordItems(records, [], [REPO]) });
    reread();
    const commands = createItemCommands({
        factoryContext: null,
        checkoutOf: async () => checkout,
        board,
        items: {} as ItemSource,
        records,
        reread,
        offerModelChoices: () => [],
        archive: () => [],
        projectOf: projectOf as never,
        baseOf: async () => 'main',
        buildAccessOf: () => ({ 'push-branch': 'allowed' }),
    });
    return { workId: build.workId, commands, projectOf };
}

test('a build that never started plans nothing, so Abandon offers no branch the board only derived from its name', async () => {
    const { workId, commands, projectOf } = noticedBuild(dir);
    const reply = await commands.inspectOwnedCleanup(workId);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual((reply.body as Inspected).plans, []);
    assert.equal(projectOf.mock.calls.length, 0);
});

test('a build with a recorded thread and no saved branch still plans its derived branch', async () => {
    const { workId, commands } = noticedBuild(checkoutWithBranches('slice/other'));
    records.addThread(workId, records.read(workId).revision, 'build-thread', 'build');
    const reply = await commands.inspectOwnedCleanup(workId);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal((reply.body as Inspected).plans.length, 1);
});

test('a confirmed cleanup persists ownership without changing the plan, and Abandon then moves the build into Archive', async () => {
    const { workId, sliceBranch, checkout, commands, board } = closedBuild();
    const { token } = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    const cleaned = await commands.executeOwnedCleanup(workId, { token, local: true, remote: true });
    assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
    assert.deepEqual((cleaned.body as { errors: string[] }).errors, []);
    assert.deepEqual(refs(checkout), ['main']);
    assert.equal(deleteRemoteBranch.mock.calls.length, 2);
    assert.equal((await commands.abandon(workId)).status, 200);
    assert.equal(board.find(workId), undefined);
    assert.equal(records.read(workId).setAside, true);
    assert.ok(!refs(checkout).includes(sliceBranch));
});

test('a selection with nothing ticked persists no ownership, and unticked branches are no failure', async () => {
    const { workId, sliceBranch, commands } = closedBuild();
    const { token } = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    const reply = await commands.executeOwnedCleanup(workId, { token });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const body = reply.body as { errors: string[]; remainingBranches: string[] };
    assert.deepEqual(body.errors, []);
    assert.deepEqual(body.remainingBranches.toSorted(), [BRANCH, sliceBranch].toSorted());
    assert.deepEqual(records.cleanupOwnership(workId), []);
});

/** Removes `branch` from the checkout and its origin, and has the PR host report it not pushed. */
function deleteEverywhere(checkout: string, branch: string) {
    git(checkout, 'push', 'origin', '--delete', branch);
    git(checkout, 'branch', '-D', branch);
    vi.mocked(prHost).mockReturnValue({
        branchExists: async (_repo: string, name: string) => name !== branch,
        openPrByHead: async () => null,
        deleteRemoteBranch,
    } as unknown as ReturnType<typeof prHost>);
}

test('a confirmed cleanup drops a saved slice branch that was already deleted, with nothing ticked', async () => {
    const { workId, sliceBranch, checkout, commands } = closedBuild();
    records.captureCleanup(workId, records.read(workId).revision, BRANCH, [sliceBranch]);
    deleteEverywhere(checkout, sliceBranch);
    const { token, plans } = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    assert.deepEqual(
        plans.map((plan) => plan.branch),
        [BRANCH, sliceBranch],
    );
    const reply = await commands.executeOwnedCleanup(workId, { token });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const body = reply.body as { errors: string[]; remainingBranches: string[] };
    assert.deepEqual(body.errors, []);
    assert.deepEqual(body.remainingBranches, [BRANCH]);
    assert.deepEqual(
        records.cleanupOwnership(workId).flatMap((snapshot) => snapshot.sliceBranches),
        [],
    );
    assert.deepEqual(
        records.cleanupOwnership(workId).map((snapshot) => snapshot.branch),
        [BRANCH],
    );
});

test('a gone branch that was never saved causes no error, and nothing ticked persists no ownership', async () => {
    const { workId, sliceBranch, checkout, commands } = closedBuild();
    deleteEverywhere(checkout, BRANCH);
    const { token } = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    const reply = await commands.executeOwnedCleanup(workId, { token });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const body = reply.body as { errors: string[]; remainingBranches: string[] };
    assert.deepEqual(body.errors, []);
    assert.deepEqual(body.remainingBranches, [sliceBranch]);
    assert.deepEqual(records.cleanupOwnership(workId), []);
});

test('a failed cleanup step keeps the item and notice, and a retry inspects again in the same order and can succeed', async () => {
    const { workId, sliceBranch, commands, board } = closedBuild();
    const first = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    deleteRemoteBranch.mockRejectedValueOnce(new Error('refused'));
    const failed = await commands.executeOwnedCleanup(workId, { token: first.token, remote: true });
    assert.deepEqual((failed.body as { errors: string[] }).errors, [`Could not delete remote branch ${BRANCH}`]);
    assert.ok(board.find(workId)?.needsYou, 'the notice stays');
    assert.equal(records.read(workId).setAside, false);
    assert.equal(
        (await commands.executeOwnedCleanup(workId, { token: first.token, remote: true })).status,
        409,
        'execution consumed the token',
    );
    const again = (await commands.inspectOwnedCleanup(workId)).body as Inspected;
    assert.deepEqual(
        again.plans.map((plan) => plan.branch),
        [BRANCH, sliceBranch],
    );
    const retried = await commands.executeOwnedCleanup(workId, { token: again.token, remote: true });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.deepEqual((retried.body as { errors: string[] }).errors, []);
});

test('Abandon and close ticket works on started work a notice offers to abandon', async () => {
    const { workId, commands, board, closes } = closedBuild('open');
    assert.ok(board.find(workId)?.needsYou?.ticketOpen);
    const reply = await commands.abandonAndClose(workId);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(closes, [7]);
    assert.equal(records.read(workId).setAside, true);
});

test('Abandon and close ticket is refused when the notice says the ticket is not open', async () => {
    const { workId, commands, board, closes } = closedBuild('closed');
    const reply = await commands.abandonAndClose(workId);
    assert.equal(reply.status, 409);
    assert.deepEqual(closes, []);
    assert.ok(board.find(workId)?.needsYou);
    assert.equal(records.read(workId).setAside, false);
});

test("a build that T3 can't inspect fails inspection and stays abandonable; work with nothing to inspect needs no T3", async () => {
    const { workId, commands } = closedBuild('closed', async () => ({ error: 'T3 is unavailable.' }));
    const reply = await commands.inspectOwnedCleanup(workId);
    assert.equal(reply.status, 409);
    assert.equal((reply.body as { error: string }).error, 'T3 is unavailable.');
    assert.deepEqual(records.cleanupOwnership(workId), []);
    const issue = records.create({ title: 'Plain', repository: REPO, kind: 'issue', status: 'In progress' });
    assert.equal((await commands.abandon(workId)).status, 200);
    const plain = await commands.inspectOwnedCleanup(issue.workId);
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.deepEqual((plain.body as Inspected).plans, []);
});
