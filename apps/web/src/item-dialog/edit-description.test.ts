// Editing the description in the item dialog: Edit opens the description editor once the details load, Save writes it
// to GitHub or Azure DevOps through the board and reads the details again, Cancel drops it, a failed save keeps the
// draft, and closing with unsaved changes asks first. The expand control grows the dialog, the editor with it.

import { expect, test } from 'vite-plus/test';
import { $, $$, detailsRead, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import { selectAll, selectEnd, typeInto } from '../../test/editor.ts';
import type { BoardData, Item, ItemDetails, RepositorySetup } from '@lar-factory/shared';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const description = () => inDialog('[data-description]')!;
const buttonIn = (el: Element, name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === name);
const editButton = () => buttonIn(description(), 'Edit');
const editorArea = () => description().querySelector<HTMLElement>('[contenteditable]');
const prompt = () => $$('[role="dialog"]').find((d) => text(d).includes('Discard changes?'));

const details = (body: string, more: Partial<ItemDetails> = {}): ItemDetails => ({
  body, format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null, ...more,
});

/**
 * Serves the board, each details read from `served` (which a test changes as a save would), and each save from
 * `saves`, which holds the save until the test answers it.
 */
function serve(board: BoardData, served: Record<string, ItemDetails>) {
  const saves: ((status: number, body: object) => Promise<void>)[] = [];
  fetchMock.mockImplementation(async (url: string) => {
    const itemId = detailsRead(url);
    if (itemId) return new Response(JSON.stringify({ details: served[itemId] }));
    if (url === '/api/item-description') return new Promise<Response>((resolve) => {
      saves.push((status, body) => settle(() => resolve(new Response(JSON.stringify(body), { status }))));
    });
    return new Response(JSON.stringify(board));
  });
  return {
    /** Answers the save in flight. */
    answer: (status: number, body: object) => saves.shift()!(status, body),
    saved: () => (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url]) => url === '/api/item-description').map(([, init]) => JSON.parse(init!.body as string)),
    reads: (itemId: string) => (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url, init]) => detailsRead(url) === itemId && !init?.signal?.aborted).length,
  };
}

async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}
const isOpen = async () => (await import('./item-dialog-store.ts')).useItemDialogStore.getState().itemId !== null;
const press = (button: HTMLButtonElement | undefined) => settle(() => button!.click());
const escape = (el: Element) => settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

/** Types `text` after the editor's text. */
const typeAtEnd = async (text: string) => {
  await selectEnd(editorArea()!);
  await typeInto(editorArea()!, text);
};

/** The board with every repository letting the factory edit its tickets, as its Edit dialog's Offer does. */
const allowEdits = (board: BoardData): BoardData =>
  ({ ...board, repos: board.repos.map((r) => ({ ...r, setup: { consent: ['edit-ticket'] } as unknown as RepositorySetup })) });
const editing = allowEdits(sample);

/** An item of the sample re-pointed at an Azure DevOps repository, as a work item is. */
const azureBoard = (): [BoardData, string] => {
  const id = 'azure:contoso/310';
  const item: Item = { ...sample.items[0]!, id, number: 310, repo: 'contoso/Fabrikam/web', url: 'https://dev.azure.com/contoso/Fabrikam/_workitems/edit/310', labels: ['bug'] };
  return [allowEdits({ ...sample, repos: [...sample.repos, { repo: item.repo!, role: 'Web client', items: 'azure-board', team: 'Web', show: 'all', labels: [] }], items: [item, ...sample.items.slice(1)] }), id];
};
const github = sample.items[0]!.id;

test('Edit shows once the details load, opens the editor on the description and focuses it', async () => {
  serve(editing, { [github]: details('- one\n- two') });
  await mountPage(editing);
  await openItem(github);
  expect(editButton()).toBeDefined();
  const heading = description().querySelector('h2')!;
  expect([text(heading), heading.classList.contains('uppercase')], 'a small uppercase heading beside Edit').toEqual(['Description', true]);
  await press(editButton());
  expect(editButton(), 'Edit hides while editing').toBeUndefined();
  expect([...editorArea()!.querySelectorAll('ul > li')].map(text)).toEqual(['one', 'two']);
  expect(document.activeElement).toBe(editorArea());
  expect(text(description())).toContain('No changes');
  expect(buttonIn(description(), 'Save')!.disabled, 'nothing to save yet').toBe(true);
});

test("Edit is offered only while this Mac lets the factory edit the repository's tickets", async () => {
  serve(sample, { [github]: details('Old text.') });
  await mountPage(sample);
  await openItem(github);
  expect(text(description())).toContain('Old text.');
  expect(editButton()).toBeUndefined();
});

test('Edit is not offered while the details load', async () => {
  fetchMock.mockImplementation(async (url: string) => (detailsRead(url) ? new Promise<Response>(() => {}) : new Response(JSON.stringify(sample))));
  await mountPage(editing);
  await openItem(github);
  expect(inDialog('[aria-busy="true"]')).not.toBeNull();
  expect([...dialog()!.querySelectorAll('button')].some((b) => text(b) === 'Edit')).toBe(false);
});

test('Save writes the new Markdown to the GitHub issue, reads the details again and shows the new text', async () => {
  const served = { [github]: details('Old text.') };
  const board = serve(editing, served);
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await typeAtEnd(' More.');
  expect(text(description())).toContain('Unsaved changes');
  await press(buttonIn(description(), 'Save'));
  expect(board.saved()).toEqual([{ itemId: github, body: 'Old text. More.' }]);
  expect(editorArea()!.getAttribute('contenteditable'), 'the editor locks while it saves').toBe('false');
  served[github] = details('Old text. More.');
  const before = board.reads(github);
  await board.answer(200, { error: null });
  expect(board.reads(github), 'the details are read again').toBe(before + 1);
  expect(editorArea()).toBeNull();
  expect(text(description())).toContain('Old text. More.');
  expect(editButton()).toBeDefined();
});

test('a save whose reload fails shows the saved text, says so, and Edit opens on the saved text', async () => {
  const served: Record<string, ItemDetails> = { [github]: details('Old text.') };
  const board = serve(editing, served);
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await typeAtEnd(' More.');
  await press(buttonIn(description(), 'Save'));
  delete served[github];
  await board.answer(200, { error: null });
  expect(editorArea()).toBeNull();
  expect(text(dialog()!)).not.toContain('Could not load the details');
  expect(text(description())).toContain('Old text. More.');
  const status = description().querySelector('[role="status"]')!;
  expect([text(status), status.getAttribute('title')], 'the truncated status has its whole text as a title')
    .toEqual(['Saved; could not reload the details', 'Saved; could not reload the details']);
  await press(editButton());
  expect(text(editorArea()!), 'Edit starts from the text just saved, not the old details').toBe('Old text. More.');
  await typeAtEnd(' Again.');
  served[github] = details('Old text. More. Again.');
  await press(buttonIn(description(), 'Save'));
  expect(board.saved().at(-1)).toEqual({ itemId: github, body: 'Old text. More. Again.' });
  await board.answer(200, { error: null });
  expect(text(description())).not.toContain('could not reload');
  expect(text(description())).toContain('Old text. More. Again.');
});

test('a save whose reload fails drops the cached details, so a reopen reads them again rather than showing the old text', async () => {
  const served: Record<string, ItemDetails> = { [github]: details('Old text.') };
  const board = serve(editing, served);
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await typeAtEnd(' More.');
  await press(buttonIn(description(), 'Save'));
  delete served[github];
  await board.answer(200, { error: null });
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().close());
  served[github] = details('Old text. More.');
  const before = board.reads(github);
  await openItem(github);
  expect(board.reads(github), 'the reopen reads the details again').toBe(before + 1);
  expect(text(description())).toContain('Old text. More.');
  await press(editButton());
  expect(text(editorArea()!), 'Edit opens on the saved text').toBe('Old text. More.');
});

test('Cancel closes the editor and writes nothing', async () => {
  const board = serve(editing, { [github]: details('Old text.') });
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await typeAtEnd(' More.');
  await press(buttonIn(description(), 'Cancel'));
  expect(editorArea()).toBeNull();
  expect(text(description())).toContain('Old text.');
  expect(text(description())).not.toContain('More.');
  expect(board.saved()).toEqual([]);
});

test('an Azure work item saves to the field and revision its details gave, and an HTML description opens and saves as Markdown', async () => {
  const [data, id] = azureBoard();
  const served = { [id]: details('<p>Steps:</p><ul><li><b>Play</b></li><li>Quit</li></ul>', { format: 'html', bodyField: 'Microsoft.VSTS.TCM.ReproSteps', revision: 7, sections: [{ title: 'Acceptance Criteria', body: '<p>It plays.</p>', format: 'html' }] }) };
  const board = serve(data, served);
  await mountPage(data);
  await openItem(id);
  await press(editButton());
  expect([...editorArea()!.querySelectorAll('ul > li')].map(text)).toEqual(['Play', 'Quit']);
  expect(editorArea()!.querySelector('strong, b')).not.toBeNull();
  expect(text(description()), 'opening an HTML description is not a change').toContain('No changes');
  expect(description().querySelectorAll('[contenteditable]'), 'Acceptance Criteria stays read-only').toHaveLength(1);
  expect(text(description())).toContain('It plays.');
  await typeAtEnd('!');
  await press(buttonIn(description(), 'Save'));
  expect(board.saved()).toEqual([{ itemId: id, body: 'Steps:\n\n- **Play**\n- Quit!', bodyField: 'Microsoft.VSTS.TCM.ReproSteps', revision: 7 }]);
  served[id] = details('Steps:\n\n- **Play**\n- Quit!', { bodyField: 'Microsoft.VSTS.TCM.ReproSteps', revision: 8 });
  await board.answer(200, { error: null });
  expect(editorArea()).toBeNull();
  expect([...description().querySelectorAll('li')].map(text)).toEqual(['Play', 'Quit!']);
});

test('a failed save, such as an Azure conflict, keeps the editor open with the draft and shows the error', async () => {
  const [data, id] = azureBoard();
  const board = serve(data, { [id]: details('Old text.', { bodyField: 'System.Description', revision: 3 }) });
  await mountPage(data);
  await openItem(id);
  await press(editButton());
  await typeAtEnd(' More.');
  await press(buttonIn(description(), 'Save'));
  const error = 'Could not save the description. Someone else changed work item 310 since you opened it. Copy your text, close the item and open it again to edit the latest version.';
  await board.answer(409, { error });
  expect(editorArea()!.getAttribute('contenteditable')).toBe('true');
  expect(text(editorArea())).toBe('Old text. More.');
  const alert = description().querySelector('[role="alert"]')!;
  expect(text(alert), 'the board\'s message, said once').toBe(error);
  expect(alert.closest('[data-edit-actions]'), 'it takes the place of "Unsaved changes", in Save\'s row, which stays in view')
    .toBe(buttonIn(description(), 'Save')!.closest('[data-edit-actions]'));
  expect(alert.closest('[data-edit-actions]')).not.toBeNull();
});

test('closing with unsaved changes asks "Discard changes?": Keep editing stays, Discard closes', async () => {
  serve(editing, { [github]: details('Old text.') });
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await typeAtEnd(' More.');
  await escape(editorArea()!);
  expect(prompt(), 'the prompt asks first').toBeDefined();
  expect(await isOpen()).toBe(true);
  await press(buttonIn(prompt()!, 'Keep editing'));
  expect(prompt()).toBeUndefined();
  expect(text(editorArea())).toBe('Old text. More.');
  await escape(editorArea()!);
  await press(buttonIn(prompt()!, 'Discard'));
  expect(await isOpen()).toBe(false);
});

test('Escape in the Link URL field closes the field, not the dialog', async () => {
  serve(editing, { [github]: details('Old text.') });
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await selectAll(editorArea()!);
  await press(description().querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Link"]')!);
  const field = () => $('input[aria-label="Link URL"]');
  expect(field()).not.toBeNull();
  await escape(field()!);
  expect(field()).toBeNull();
  expect(await isOpen()).toBe(true);
  expect(editorArea(), 'the editor stays open').not.toBeNull();
});

test('closing with the editor open but nothing changed closes at once', async () => {
  serve(editing, { [github]: details('- one\n- two') });
  await mountPage(editing);
  await openItem(github);
  await press(editButton());
  await escape(editorArea()!);
  expect(prompt()).toBeUndefined();
  expect(await isOpen()).toBe(false);
});

test('the expand button and Ctrl+Shift+E grow the item dialog and back, the editor filling its height', async () => {
  serve(editing, { [github]: details('Old text.') });
  await mountPage(editing);
  await openItem(github);
  const expand = () => inDialog<HTMLButtonElement>('button[data-expand]')!;
  await press(expand());
  expect(dialog()!.style.height).toBe('calc(100dvh - (52px + 1rem))');
  await press(editButton());
  expect(description().querySelector('[data-description-editor]')!.className.split(' ')).toContain('flex-1');
  await settle(() => editorArea()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true })));
  expect(dialog()!.style.height, 'restored').toBe('');
  expect(description().querySelector('[data-description-editor]')!.className.split(' ')).not.toContain('flex-1');
});
