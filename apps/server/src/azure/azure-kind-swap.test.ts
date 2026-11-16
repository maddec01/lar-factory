import {
    effectiveVocabulary,
    writeTrackerStructure,
    type RepositorySetup,
    type TrackerStructure,
} from '@lar-factory/shared';
import { ticketKinds, trackerLabels } from '@lar-factory/shared/tracker-labels';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { changeKind } from '@lar-factory/work-records/change-kind';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A kind change on the fake Azure DevOps: the type changes with the main text in the field the new type shows, through the
// tracker adapter item details and lar-work share, and the work item reads back with that text.
import { afterEach, expect, test } from 'vite-plus/test';

import { fakeAz, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const on = (
    item: Omit<WorkItem, 'id' | 'state'>,
    more: Parameters<typeof fakeAz>[0] extends infer O ? Partial<O> : never = {},
) => {
    const workItem: WorkItem = { id: 7, state: 'New', ...item };
    const az = fakeAz({ items: [workItem], ...more });

    return {
        workItem,
        az,
        kinds: ticketKinds(REPO, { gh: async () => '', az: az.run }),
        labels: trackerLabels(REPO, { gh: async () => '', az: az.run }),
    };
};

test('a User Story becoming a Bug shows its description in Repro Steps, and the description stays', async () => {
    const { workItem, kinds, az } = on({ type: 'User Story', description: '<p>The main text</p>' });

    await kinds.setType(7, 'Bug');
    expect(workItem).toMatchObject({
        type: 'Bug',
        reproSteps: '<p>The main text</p>',
        description: '<p>The main text</p>',
    });
    expect(az.patches[0]!.ops[0]).toEqual({ op: 'test', path: '/rev', value: 1 });
    expect(workItem.rev).toBe(2);
});

test('structure stays in the description, in one copy, whichever way the type changes', async () => {
    const structure: TrackerStructure = {
        version: 1,
        kind: 'bug',
        identity: '11111111-1111-4111-8111-111111111111',
        repository: REPO,
    };
    const toBug = on({ type: 'User Story', description: writeTrackerStructure('Text', structure) });

    await toBug.kinds.setType(7, 'Bug');
    expect(toBug.workItem.reproSteps).toBe('Text');
    expect(toBug.workItem.description).toContain('lar-factory:structure');

    const toStory = on({ type: 'Bug', reproSteps: 'Steps', description: writeTrackerStructure('', structure) });

    await toStory.kinds.setType(7, 'User Story');
    expect(toStory.workItem.description!.startsWith('Steps')).toBe(true);
    expect(toStory.workItem.description!.split('lar-factory:structure')).toHaveLength(2);
});

test('someone changing the work item since the read fails the type change whole', async () => {
    const { workItem, az } = on({ type: 'User Story', description: 'Text' });
    const stale = fakeAz({ items: [workItem] });
    const racing = ticketKinds(REPO, {
        gh: async () => '',
        az: async (args) => {
            const answer = await az.run(args);

            if (args.includes('workitemsbatch')) workItem.rev = 5;

            return answer;
        },
    });

    await expect(racing.setType(7, 'Bug')).rejects.toThrow(/TF26071/);
    expect(workItem.type).toBe('User Story');
    expect(stale.patches).toEqual([]);
});

async function recordOn(kind: 'bug' | 'feature') {
    const dir = mkdtempSync(join(tmpdir(), 'azure-kind-swap-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return { records, ...records.importTicket({ title: 'T', repository: REPO, kind, ticket: `${REPO}#7` }).record };
}

const setup = {
    repo: REPO,
    access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
    itemSource: { kind: 'azure-board', team: 'Fabrikam Team' },
    vocabulary: effectiveVocabulary({
        bug: { type: 'Bug', labels: ['type-bug'] },
        feature: { type: 'User Story', labels: ['type-feature'] },
    }).vocabulary,
} as unknown as RepositorySetup;

test('a kind change swaps tags and type on the fake, moves the text and keeps other tags', async () => {
    const { workItem, az, labels, kinds } = on(
        { type: 'Bug', tags: 'type-bug; defect; build; area-ui', reproSteps: '<p>Steps</p>' },
        { requirementTypes: ['User Story', 'Bug'] },
    );
    const { records, workId, revision } = await recordOn('bug');
    const result = await changeKind(records, workId, revision, 'feature', { setup, labels, kinds });

    expect(result.error).toBeNull();
    expect(result.line).toBe(
        '#7: added tag type-feature; removed tag type-bug; removed tag defect; type Bug to User Story.',
    );
    expect(workItem).toMatchObject({
        type: 'User Story',
        tags: 'build; area-ui; type-feature',
        description: '<p>Steps</p>',
        reproSteps: '<p>Steps</p>',
    });
    expect(az.calls.some((args) => args.includes('backlogconfiguration') && args.includes('team=Fabrikam Team'))).toBe(
        true,
    );
});

test('a failed type change on the fake keeps the old kind, and running it again finishes', async () => {
    let refuse = true;
    const { workItem, labels, kinds } = on(
        { type: 'Bug', tags: 'type-bug', reproSteps: 'Steps' },
        {
            requirementTypes: ['User Story', 'Bug'],
            fail: (args) =>
                refuse && args[0] === 'rest' && args.some((arg) => arg.includes('7.2-preview'))
                    ? new Error('az rest failed: TF401320')
                    : undefined,
        },
    );
    const { records, workId, revision } = await recordOn('bug');
    const failed = await changeKind(records, workId, revision, 'feature', { setup, labels, kinds });

    expect(failed.error).toContain('TF401320');
    expect(failed.line).toBe('#7: added tag type-feature; removed tag type-bug.');
    expect(records.read(workId).kind).toBe('bug');
    refuse = false;

    const retried = await changeKind(records, workId, revision, 'feature', { setup, labels, kinds });

    expect(retried.line).toBe('#7: type Bug to User Story.');
    expect(workItem).toMatchObject({ type: 'User Story', tags: 'type-feature', description: 'Steps' });
    expect(records.read(workId).kind).toBe('feature');
});
