import type { Item } from '@lar-factory/shared';
import { beforeEach, expect, test } from 'vite-plus/test';

import type {
    rowLabels as RowLabels,
    rowTitle as RowTitle,
    rowTooltip as RowTooltip,
    trackerFacts as TrackerFacts,
} from './ListRowFacts';
import { mountPage } from '@/test/PageTest';

// The stores read the page's data as they load.
let rowLabels: typeof RowLabels;
let trackerFacts: typeof TrackerFacts;
let rowTitle: typeof RowTitle;
let rowTooltip: typeof RowTooltip;

beforeEach(async () => {
    await mountPage();
    ({ rowLabels, rowTitle, rowTooltip, trackerFacts } = await import('./ListRowFacts'));
});

const azure = { type: 'Product Backlog Item', state: 'Committed', assignee: 'Alex Morgan' };

test("a row's tooltip keeps a work item's state and assignee, and its type only where the kind mark doesn't say it", () => {
    expect(trackerFacts({ kind: 'feature', azure } as Item)).toBe('Committed · Alex Morgan');
    expect(trackerFacts({ kind: 'issue', azure } as Item)).toBe('Product Backlog Item · Committed · Alex Morgan');
    expect(trackerFacts({ kind: 'feature' } as Item)).toBe('');
});

test('a row drops a label that only repeats its project’s name', () => {
    expect(rowLabels(['Mobile App', 'Refactor', ' mobile app '], 'Mobile App')).toEqual(['Refactor']);
});

test('a row cuts a run of one repeated mark or emoji to three, so a separator ticket’s words still show', () => {
    expect(rowTitle('🚀🚀🚀🚀============ Everything above this line is the current sprint')).toBe(
        '🚀🚀🚀=== Everything above this line is the current sprint',
    );
    expect(rowTitle('Wait... really?!')).toBe('Wait... really?!');
    expect(rowTitle('Release 1000000')).toBe('Release 1000000');
});

test('a row’s tooltip names its labels after its title and tracker fields', () => {
    expect(rowTooltip('Fix login', 'Committed', ['Blocked', 'Mobile'])).toBe(
        'Fix login\nCommitted\nLabels: Blocked, Mobile',
    );
    expect(rowTooltip('Fix login', '', [])).toBe('Fix login');
});
