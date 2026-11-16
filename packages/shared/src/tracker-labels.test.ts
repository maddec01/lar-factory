import { afterEach, expect, test, vi } from 'vite-plus/test';

import { ticketKinds, trackerLabels } from './tracker-labels.ts';

afterEach(() => {
    vi.unstubAllEnvs();
});

/** A gh that records each call and its JSON body, answering from `answer`. */
function fakeGh(answer: (method: string, path: string) => unknown = () => ({ name: 'x' })) {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const gh = async (args: string[], input?: string) => {
        const method = args[args.indexOf('--method') + 1]!;
        const path = args[args.indexOf('--method') + 2]!;

        calls.push({ method, path, ...(input !== undefined && { body: JSON.parse(input) as unknown }) });

        const answered = answer(method, path);

        return answered === undefined ? '' : JSON.stringify(answered);
    };

    return {
        calls,
        commands: {
            gh,
            az: async () => {
                throw new Error('az is not for a GitHub repository');
            },
        },
    };
}

test('GitHub adds and removes labels on a ticket one change at a time, never setting the whole list', async () => {
    const { calls, commands } = fakeGh(() => []);
    const labels = trackerLabels('team/app', commands);

    await labels.addToTicket(7, ['one', 'two']);
    await labels.removeFromTicket(7, ['three', 'four five']);
    expect(calls).toEqual([
        { method: 'POST', path: 'repos/team/app/issues/7/labels', body: { labels: ['one', 'two'] } },
        { method: 'DELETE', path: 'repos/team/app/issues/7/labels/three' },
        { method: 'DELETE', path: 'repos/team/app/issues/7/labels/four%20five' },
    ]);
});

const azureRepo = 'contoso/Fabrikam%20Fiber/lar-api';
const noAz = (calls: string[][]) => ({
    gh: async () => {
        throw new Error('gh is not for an Azure repository');
    },
    az: async (args: string[]) => {
        calls.push(args);

        return '{"value":[]}';
    },
});

test('in a read-only session every Azure label write is refused with the existing reason, before az runs', async () => {
    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');

    const calls: string[][] = [];
    const labels = trackerLabels(azureRepo, noAz(calls));
    const reason = 'Azure DevOps is read-only in this test session.';

    await expect(labels.create({ name: 'new' })).rejects.toThrow(reason);
    await expect(labels.update('old', { name: 'new' })).rejects.toThrow(reason);
    await expect(labels.delete('old')).rejects.toThrow(reason);
    await expect(labels.addToTicket(1, ['new'])).rejects.toThrow(reason);
    await expect(labels.removeFromTicket(1, ['old'])).rejects.toThrow(reason);
    expect(calls).toEqual([]);
    await labels.list();
    expect(calls).toHaveLength(1);
});

test("neither tracker addresses a label named .., which encoding can't keep inside its route", async () => {
    const name = '..';
    const calls: string[][] = [];
    const { calls: ghCalls, commands } = fakeGh();

    await expect(trackerLabels(azureRepo, noAz(calls)).update(name, { name: 'new' })).rejects.toThrow("can't address");
    await expect(trackerLabels(azureRepo, noAz(calls)).delete(name)).rejects.toThrow("can't address");
    await expect(trackerLabels('team/app', commands).delete(name)).rejects.toThrow("can't address");
    await expect(trackerLabels('team/app', commands).update(name, { name: 'new' })).rejects.toThrow("can't address");
    await expect(trackerLabels('team/app', commands).removeFromTicket(7, [name])).rejects.toThrow("can't address");
    expect([calls, ghCalls]).toEqual([[], []]);
});

test("GitHub reads a ticket's labels and type, and changes its type by name", async () => {
    const { calls, commands } = fakeGh(() => ({
        number: 12,
        labels: [{ name: 'bug' }, { name: 'docs' }],
        type: { name: 'Bug' },
    }));
    const kinds = ticketKinds('team/app', commands);

    expect(await kinds.read(12)).toEqual({ labels: ['bug', 'docs'], type: 'Bug' });
    await kinds.setType(12, 'Feature');
    expect(calls).toEqual([
        { method: 'GET', path: 'repos/team/app/issues/12' },
        { method: 'PATCH', path: 'repos/team/app/issues/12', body: { type: 'Feature' } },
    ]);
    expect(await kinds.boardTypes()).toBeNull();
});
