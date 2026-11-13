import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { deskItems } from './board-view.ts';
import { deskWait } from './desk-wait.ts';
import { humanWait } from './human-wait.ts';
import type { Item } from './item-domain.ts';
import { retroWaits, type Retro } from './retro.ts';

const retro: Retro = {
    pr: 'owner/repo#1',
    suggestions: [{ title: 'Help', description: 'Clarify examples', repository: 'owner/repo', kind: 'improvement' }],
    choice: null,
    captures: [{ requestId: 'capture', ticketRequestId: 'ticket', workId: null, error: null, complete: false }],
    delivery: { threadId: 'build', commandId: 'command', messageId: 'message', sent: true, error: null },
};
const item = {
    ...sample.items[0],
    status: 'Done',
    threads: [],
    needsYou: undefined,
    parentId: null,
    flow: 'single',
    retro,
} as unknown as Item;

test('a Done retro has one desk wait even with no T3 pending request or disconnected activity', () => {
    expect(deskWait(item).label).toBe('Choose follow-ups');
    expect(humanWait(item, true)?.action).toEqual({ kind: 'details', label: 'Choose follow-ups' });
    expect(deskItems({ items: [item] }, false)).toEqual([item]);
    expect(deskItems({ items: [item] }, true)).toEqual([item]);
    expect(retroWaits({ ...retro, suggestions: [] })).toBe(false);
    expect(retroWaits({ ...retro, choice: { selected: [], by: 'Pedro', at: 'today' } })).toBe(false);
    expect(retroWaits({ ...retro, choice: { selected: [0], by: 'Pedro', at: 'today' } })).toBe(true);
    expect(
        retroWaits({
            ...retro,
            choice: { selected: [0], by: 'Pedro', at: 'today' },
            captures: [{ ...retro.captures[0]!, complete: true }],
        }),
    ).toBe(false);
});
