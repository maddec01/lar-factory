// The item dialog's work record: its brief, map or decision with its build phase, review rounds and initial context,
// its private slices and blockers, the ticket's description and comments as ticket context, and Export markdown.

import { expect, test } from 'vite-plus/test';
import type { Item, ItemDetails, RecordDetails } from '@lar-factory/shared';
import sampleDetailsJson from '@lar-factory/shared/test/sample-details.json' with { type: 'json' };
import { $, $$, detailsRead, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';

const sampleDetails = sampleDetailsJson as unknown as Record<string, ItemDetails>;
const NO_TICKET: ItemDetails = { body: '', format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null };

const brief: RecordDetails = {
  bodyKind: 'brief', body: '# Owner accounts\n\nAdd an **owner** table.', context: 'Owners sign up from the website.', buildPhase: 'review',
  reviewRounds: [{ round: 1, recordedAt: '2026-10-20T10:00:00Z', reviewers: [
    { axis: 'code', verdict: 'changes', findings: 2, open: 1 }, { axis: 'security', verdict: 'approve', findings: 0, open: 0 }] }],
};

const dialog = () => $('[data-item-dialog]')!;
const record = () => dialog().querySelector('[data-record]');

/** Answers each details read with `details` for its item, and each export with `exported`; the rest get the board. */
function answer(details: Record<string, ItemDetails>, exported: () => Response = () => new Response('{}')) {
  fetchMock.mockImplementation(async (url: string) => {
    const itemId = detailsRead(url);
    if (itemId) return new Response(JSON.stringify({ details: details[itemId] ?? NO_TICKET }));
    if (url === '/api/item-export') return exported();
    return new Response(JSON.stringify(sample));
  });
}

async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}

/** Two ticketless builds, as captured work is: a work ID, no ticket number and no link. */
const ticketless = (id: string, title: string, change: Partial<Item> = {}): Item =>
  ({ ...sample.items.find((i) => i.id === 'I_sample13')!, id, number: 0, url: null, title, labels: [], linkedPrs: [], parent: null, parentId: null, ...change });

test("a picked ticket's build shows its brief, build phase, review rounds and initial context, then the ticket's text as ticket context", async () => {
  answer({ I_sample13: { ...sampleDetails.I_sample13!, record: brief } });
  await mountPage();
  await openItem('I_sample13');
  expect(text(record()!.querySelector('h2'))).toBe('Brief');
  expect(text(record()!.querySelector('[data-record-body] h1'))).toBe('Owner accounts');
  expect(record()!.querySelector('[data-record-body] strong')!.textContent).toBe('owner');
  expect(text(record()!.querySelector('[data-build-phase]'))).toBe('Build phasereview');
  expect(text(record()!.querySelector('[data-review-rounds]'))).toBe('Review round 1code: changes, 1 of 2 findings opensecurity: approve');
  expect(text(record()!.querySelector('details summary'))).toBe('Initial context');
  expect(text(record()!.querySelector('details [data-slot="rich-text"]'))).toBe('Owners sign up from the website.');
  const ticket = dialog().querySelector('[data-description]')!;
  expect(text(ticket.querySelector('h2'))).toBe('Ticket description');
  expect(record()!.compareDocumentPosition(ticket) & Node.DOCUMENT_POSITION_FOLLOWING, 'the record comes first').toBeTruthy();
  expect(text(dialog().querySelector('[data-comments] h2'))).toBe('Ticket comments · 3');
});

test('a concept shows its map and a decision its text, each with a note while none is written', async () => {
  const concept = ticketless('W_concept', 'Cloud', { kind: 'concept' });
  const decision = ticketless('W_decision', 'Relay', { kind: 'decision' });
  answer({
    W_concept: { ...NO_TICKET, record: { bodyKind: 'map', body: '## Destination\n\nStream anywhere.', context: '', buildPhase: null, reviewRounds: [] } },
    W_decision: { ...NO_TICKET, record: { bodyKind: 'decision', body: '', context: '', buildPhase: null, reviewRounds: [] } },
  });
  await mountPage({ ...sample, items: [concept, decision, ...sample.items] });
  await openItem('W_concept');
  expect([text(record()!.querySelector('h2')), text(record()!.querySelector('[data-record-body] h2'))]).toEqual(['Map', 'Destination']);
  expect(record()!.querySelector('details'), 'no initial context').toBeNull();
  expect(record()!.querySelector('[data-build-phase]')).toBeNull();
  await openItem('W_decision');
  expect(text(record()!.querySelector('h2'))).toBe('Decision');
  expect(text(record()!.querySelector('[data-record-body]'))).toBe('No decision written yet.');
});

test('ticketless work shows its record alone, with its private slices and the work it waits on', async () => {
  const blocker = ticketless('W_blocker', 'Relay broker');
  const build = ticketless('W_build', 'Owner accounts', {
    blockers: [{ number: 0, repo: 'maddec01/lar-server', state: 'open', workId: 'W_blocker', title: 'Relay broker' }],
    slices: [{ number: 0, title: 'Owner table', url: '', repo: 'maddec01/lar-server', state: 'open', progress: 'active', workId: 'W_s1' },
      { number: 0, title: 'Sign-in', url: '', repo: 'maddec01/lar-server', state: 'open', progress: 'waiting', workId: 'W_s2' }],
  });
  answer({ W_build: { ...NO_TICKET, record: brief } });
  await mountPage({ ...sample, items: [build, blocker, ...sample.items] });
  await openItem('W_build');
  expect(text(record()!.querySelector('[data-record-body] h1'))).toBe('Owner accounts');
  expect(dialog().querySelector('[data-description]'), 'no ticket description').toBeNull();
  expect(dialog().querySelector('[data-comments]'), 'no ticket comments').toBeNull();
  expect($$('[data-item-dialog] [data-slices] ul li').map((li) => li.getAttribute('title'))).toEqual(['Owner table (active)', 'Sign-in (waiting)']);
  expect(text(dialog().querySelector('aside')!.querySelector('h2'))).toBe('Waits on');
  expect(text(dialog().querySelector('[data-waits-on]'))).toBe('Relay broker');
});

test('Export markdown writes the files lar-work export writes and names them; a refusal shows why', async () => {
  let reply = new Response(JSON.stringify({ paths: ['/Users/me/Downloads/brief-owner-accounts.md'], error: null }));
  answer({ I_sample13: { ...sampleDetails.I_sample13!, record: brief } }, () => reply);
  await mountPage();
  await openItem('I_sample13');
  const button = [...record()!.querySelectorAll('button')].find((b) => text(b) === 'Export markdown')!;
  await settle(() => button.click());
  const posted = fetchMock.mock.calls.find(([url]) => url === '/api/item-export') as unknown as [string, RequestInit];
  expect(JSON.parse(posted[1].body as string)).toEqual({ itemId: 'I_sample13' });
  expect(text(record()!.querySelector('[role="status"]'))).toBe('Exported to /Users/me/Downloads/brief-owner-accounts.md');
  reply = new Response(JSON.stringify({ error: "Can't export: brief-owner-accounts.md already exists." }), { status: 409 });
  await settle(() => button.click());
  expect(text(record()!.querySelector('[role="alert"]'))).toBe("Can't export: brief-owner-accounts.md already exists.");
});

test('an item whose details hold no record shows its description as before, without Export', async () => {
  answer(sampleDetails);
  await mountPage();
  await openItem('I_sample13');
  expect(record()).toBeNull();
  expect(text(dialog().querySelector('[data-description] h2'))).toBe('Description');
});
