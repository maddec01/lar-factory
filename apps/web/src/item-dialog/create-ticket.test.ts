import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, chooseOption, detailsRead, detailsReply, fetchMock, formValue, mountPage, openOptions, sample, settle, text } from '../../test/support.ts';
import type { BoardData, Item } from '@lar-factory/shared';

beforeEach(() => localStorage.removeItem('lar-board:create-ticket'));
const repo = 'example/product';
const local: Item = { ...sample.items[0]!, id: 'local-work', repo, revision: 3, kind: 'bug', number: 0, title: 'Fix export', url: null, parent: null, status: 'List', statuses: ['List'] };
const board = (access = 'allowed'): BoardData => ({ ...sample, capture: { enabled: true, session: 'session' }, items: [local], repos: [{ repo, role: '', labels: [], setup: {
  repo, createIssuesFromAddItem: false, access: { 'publish-ticket': access, 'tag-ticket': 'allowed', 'type-ticket': 'allowed' }, vocabulary: { bug: { labels: ['bug'], type: 'Bug' } },
} }] } as unknown as BoardData);
const preview = { title: 'Fix export', description: '## What\nFix it.\n\nOriginal request.', revision: 3 };
const action = () => $<HTMLButtonElement>('[data-create-ticket="local-work"]')!;
const section = () => $('[aria-label="Create issue"]')!;
const submit = () => section().querySelector<HTMLButtonElement>('button[type="submit"]')!;
const posts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/create-ticket').map(call => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>);

async function open(data = board(), post: () => Promise<Response> = async () => new Response(JSON.stringify({ error: 'HTTP 403: denied' }), { status: 502 })) {
  fetchMock.mockImplementation(async url => {
    if (url.startsWith('/api/ticket-preview')) return new Response(JSON.stringify({ preview }));
    if (url.startsWith('/api/ticket-options')) return new Response(JSON.stringify({ options: { provider: 'github', labels: ['bug'], types: ['Bug'], assignees: ['person'], milestones: [{ value: '1', name: 'Next' }], iterations: [], problems: [] } }));
    if (url === '/api/create-ticket') return post();
    const id = detailsRead(url);
    return id ? detailsReply(id) : new Response(JSON.stringify(data));
  });
  await mountPage(data);
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(local.id));
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => action().click());
}

test('local details offer Create issue beside Attach, preview noneditable text and reuse mapped provider options with Add item off', async () => {
  await open();
  expect($('[data-attach-ticket]')).not.toBeNull();
  expect(text(section().querySelector('[aria-label="Outgoing title"]'))).toBe('Fix export');
  expect(text(section().querySelector('[aria-label="Outgoing text"]'))).toBe(preview.description);
  expect(section().querySelector('[contenteditable],textarea,input[name="title"]')).toBeNull();
  expect($<HTMLInputElement>('[name="labels"]')!.value).toBe('bug');
  expect(formValue('type')).toBe('Bug');
  await settle(() => submit().click());
  expect(posts()[0]).toMatchObject({ itemId: local.id, revision: 3, preview, options: { labels: ['bug'], type: 'Bug', assignee: '', milestone: '' } });
  expect(text(section())).toContain('HTTP 403: denied');
  expect(submit().disabled).toBe(false);
});

test('the Create issue form has the searchable picker, and a typed label submits with the ticket', async () => {
  const data = board();
  (data.repos[0]!.setup!.access as Record<string, string>)['manage-labels'] = 'allowed';
  await open(data);
  await settle(() => section().querySelector<HTMLButtonElement>('#item-labels button')!.click());
  const search = $<HTMLInputElement>('[data-label-picker] input[aria-label]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'needs-design');
  await settle(() => search.dispatchEvent(new Event('input', { bubbles: true })));
  await settle(() => $$<HTMLButtonElement>('[data-label-picker] button').find(b => text(b).startsWith('Create'))!.click());
  await settle(() => submit().click());
  expect(posts()[0]).toMatchObject({ options: { labels: ['bug'], newLabels: ['needs-design'] } });
  expect(text(section())).toContain('HTTP 403: denied');
  expect($<HTMLInputElement>('[name="newLabels"]')!.value, 'a failure keeps the typed label').toBe('needs-design');
});

test('unverified Access explains the refusal, offers Recheck and disables creation', async () => {
  await open(board('unverified'));
  expect(text(section())).toContain('not checked yet');
  expect($$('button').some(button => text(button) === 'Recheck access')).toBe(true);
  expect(submit().disabled).toBe(true);
  await settle(() => submit().click());
  expect(posts()).toHaveLength(0);
});

test('a lost response survives a page reload with its request ID and options, then conversion updates the existing item', async () => {
  await open(board(), async () => { throw Error('lost response'); });
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  await settle(() => submit().click());
  const first = posts()[0]!;
  expect(text(submit())).toBe('Retry this submission');
  vi.resetModules();
  const converted = { ...local, number: 17, url: 'https://github.com/example/product/issues/17' };
  await open(board(), async () => new Response(JSON.stringify({ item: converted, board: { ...board(), items: [converted] }, error: null })));
  expect(text(submit())).toBe('Retry this submission');
  await settle(() => submit().click());
  expect(posts().at(-1)!.requestId).toBe(first.requestId);
  expect(posts().at(-1)!.options).toEqual(first.options);
  expect($('[data-create-ticket]')).toBeNull();
  expect(text($('[data-item-dialog] header'))).toContain('#17 Fix export');
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('GitHub issue. Saved on GitHub.');
});

test('an uncertain create keeps its preview and blocks another create across closing details', async () => {
  await open(board(), async () => new Response(JSON.stringify({ uncertain: true, error: 'Outcome uncertain. Check the board.' }), { status: 409 }));
  await settle(() => submit().click());
  expect(submit().disabled).toBe(true);
  await settle(() => [...section().querySelectorAll<HTMLButtonElement>('button')].find(button => text(button) === 'Cancel')!.click());
  await settle(() => action().click());
  expect(submit().disabled).toBe(true);
  expect(text(section())).toContain('Outcome uncertain');
  expect(posts()).toHaveLength(1);
});

test('opening the issue preview moves keyboard focus into it and Cancel returns to Create issue', async () => {
  await open();
  expect(section().contains(document.activeElement)).toBe(true);
  await settle(() => [...section().querySelectorAll<HTMLButtonElement>('button')].find(button => text(button) === 'Cancel')!.click());
  expect(document.activeElement).toBe(action());
});

test('the Create issue form picks in Selects whose lists open above the item dialog, and submits the picks', async () => {
  await open();
  const assignee = $('#item-assignee')!;
  await openOptions(assignee);
  const list = $('[role="listbox"]')!;
  expect($('[data-item-dialog]')!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await settle(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect($('[data-item-dialog]')).not.toBeNull();
  await chooseOption(assignee, 'person');
  await chooseOption($('#item-milestone')!, 'Next');
  await settle(() => submit().click());
  expect(posts().at(-1)).toMatchObject({ options: { type: 'Bug', assignee: 'person', milestone: '1' } });
});
