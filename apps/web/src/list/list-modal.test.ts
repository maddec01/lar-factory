// The List modal: the title bar's List button opens it, the left pane picks All, a repository, the right
// pane shows that group's items with search, Add item, Scope board and the sort menu.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { $, $$, moved, mountPage, push, sample, settle, text } from '../../test/support.ts';
import type { KindDisagreement } from '@lar-factory/shared';
afterEach(() => {
  delete (Element.prototype as Partial<Element>).getAnimations;
});

const listButton = () => $<HTMLButtonElement>('.title-bar button.list-button')!;
const modal = () => $('[role="dialog"][data-list-modal]');
const groups = () => $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Repositories"] button');
const group = (name: string) => groups().find((b) => b.querySelector('.name')?.textContent === name)!;
const counts = () => groups().map((b) => [text(b.querySelector('.name')), text(b.querySelector('.count'))]);
const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);
const search = () => $<HTMLInputElement>('[data-list-modal] input[type="search"]')!;
const open = () => settle(() => listButton().click());
const active = () => groups().filter((b) => b.getAttribute('aria-current') === 'page').map((b) => text(b.querySelector('.name')));
const closeTop = () => settle(() => $$<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]').at(-1)!.click());

async function type(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  await settle(() => search().dispatchEvent(new Event('input', { bubbles: true })));
}

/** Opens a Radix menu trigger the way a pointer does. */
const press = (el: Element) => settle(() => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
});

test('the title bar\'s List button counts the List and opens the List modal', async () => {
  await mountPage();
  expect(text(listButton())).toBe('List4');
  expect(listButton().title, 'it names itself once its label is screen-reader only').toBe('List');
  expect(modal()).toBeNull();
  await open();
  expect(modal()).not.toBeNull();
  expect(text($('[data-list-modal] h2'))).toBe('List');
});

test('the List button shows a loading cue, not 0, while the first read could add items', async () => {
  const empty = { ...sample, items: [] };
  await mountPage({ ...empty, firstRead: { step: 'items' as const, running: [], settled: false } });
  expect(text(listButton())).toBe('ListLoading projects…');
  expect(listButton().querySelector('[data-loader]')).not.toBeNull();
  await push({ ...empty, firstRead: { step: 'finishing', running: [], settled: true } });
  expect(text(listButton())).toBe('List0');
  expect(listButton().querySelector('[data-loader]')).toBeNull();
});

test('choosing a repository in the left pane shows only its items on the right', async () => {
  await mountPage();
  await open();
  expect(rows()).toEqual(['I_sample02', 'I_sample01', 'I_sample03', 'I_sample04']);
  await settle(() => group('lar-apple').click());
  expect(rows()).toEqual(['I_sample03']);
  expect(group('lar-apple').getAttribute('aria-current')).toBe('page');
  await settle(() => group('All repositories').click());
  expect(rows()).toHaveLength(4);
});

test('the left pane lists All, each repository with its count', async () => {
  await mountPage();
  await open();
  expect(counts()).toEqual([['All repositories', '4'], ['lar-server', '3'], ['lar-apple', '1']]);
  const nav = $('[data-list-modal] nav[aria-label="Repositories"]')!;
  expect(nav.querySelector('[aria-label="No repository"]')).toBeNull();
});

test('the repositories go by their items in List, most first, whatever the config\'s order', async () => {
  await mountPage({ ...sample, repos: [...sample.repos].reverse() });
  await open();
  expect(counts()).toEqual([['All repositories', '4'], ['lar-server', '3'], ['lar-apple', '1']]);
  // The order holds while the search changes the counts.
  await type('subtitle');
  expect(counts().map(([name]) => name)).toEqual(['All repositories', 'lar-server', 'lar-apple']);
});

test('the List modal starts on the board\'s scope', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  await settle(() => $<HTMLButtonElement>('[data-list-modal] button.scope-board')!.click());
  await closeTop();
  await open();
  expect(active()).toEqual(['lar-apple']);
  expect(rows()).toEqual(['I_sample03']);
});

test('under All repositories a row names its repository', async () => {
  await mountPage();
  await open();
  const meta = (id: string) => text($(`[data-list-modal] button[data-item="${id}"] .tabular-nums`));
  expect(meta('I_sample03')).toMatch(/^lar-apple · /);
  expect(meta('I_sample04')).toMatch(/^lar-server · /);
});

test('a repository whose items have not landed yet says it is reading, not that its List is empty', async () => {
  const reading = { ...sample, items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
    firstRead: { step: 'items' as const, running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false } };
  await mountPage(reading);
  await open();
  await settle(() => group('lar-apple').click());
  expect(text($('[data-list-modal] .empty'))).toBe('Loading projects…');
  expect(counts().find(([name]) => name === 'lar-apple'), 'no count in the left pane').toEqual(['lar-apple', '']);
  const header = () => text($('[data-list-modal] button.scope-board')!.parentElement);
  expect(header(), 'no count in the header').toBe('lar-appleScope boardRecently updated');
  await push({ ...sample, firstRead: { step: 'finishing', running: [], settled: true } });
  expect(rows()).toEqual(['I_sample03']);
  expect(counts().find(([name]) => name === 'lar-apple')).toEqual(['lar-apple', '1']);
  expect(header()).toBe('lar-apple1Scope boardRecently updated');
});

test('All repositories keeps a loading cue and no count under the rows that landed until the first read settles', async () => {
  const reading = { ...sample, items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
    firstRead: { step: 'items' as const, running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false } };
  await mountPage(reading);
  await open();
  const header = () => text($('[data-list-modal] span.font-semibold')!.parentElement);
  expect(rows().length).toBeGreaterThan(0);
  expect(text($('[data-list-modal] [data-reading]'))).toBe('Loading more projects…');
  expect($('[data-list-modal] [data-reading] [data-loader]')).not.toBeNull();
  expect(header(), 'no final-looking count').not.toMatch(/All repositories\d/);
  expect(counts().find(([name]) => name === 'All repositories'), 'none in the left pane either').toEqual(['All repositories', '']);
  await push({ ...sample, firstRead: { step: 'finishing', running: [], settled: true } });
  expect($('[data-list-modal] [data-reading]')).toBeNull();
  expect(header()).toMatch(/All repositories\d/);
  expect(counts()[0]).toEqual(['All repositories', '4']);
});

test('before any repository has landed, no group in the left pane shows a count', async () => {
  await mountPage({ ...sample, firstRead: { step: 'items' as const, running: [], settled: false } });
  await open();
  expect(counts()).toEqual([['All repositories', ''], ['lar-server', ''], ['lar-apple', '']]);
});

test('the search filters the right pane and the counts on the left follow it', async () => {
  await mountPage();
  await open();
  await type('subtitle');
  expect(rows()).toEqual(['I_sample03']);
  expect(counts()).toEqual([['All repositories', '1'], ['lar-server', '0'], ['lar-apple', '1']]);
  await settle(() => group('lar-server').click());
  expect(rows()).toEqual([]);
  expect(text($('[data-list-modal] .empty'))).toBe('Nothing here matches.');
});

test('Scope board scopes the board to the chosen repository, and is only there for a repository', async () => {
  await mountPage();
  await open();
  const scope = () => $<HTMLButtonElement>('[data-list-modal] button.scope-board');
  expect(scope()).toBeNull();
  await settle(() => group('lar-apple').click());
  expect(text(scope())).toBe('Scope board');
  await settle(() => scope()!.click());
  expect(text($('.title-bar button.scope'))).toBe('lar-apple');
  expect(scope()!.getAttribute('aria-pressed')).toBe('true');
  expect(text(scope())).toBe('Board scoped');
  await settle(() => scope()!.click());
  expect(text($('.title-bar button.scope'))).toBe('All repositories');
  expect(text(scope())).toBe('Scope board');
});

test('Scope board is a toggle, so it keeps its own size, not the button kinds\' 28 px', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  const scope = $('[data-list-modal] button.scope-board')!;
  expect([scope.getAttribute('data-kind'), scope.hasAttribute('data-toggle')]).toEqual(['other', true]);
});

test('the sort menu reorders the items', async () => {
  await mountPage();
  await open();
  const sort = $<HTMLButtonElement>('[data-list-modal] button.sort')!;
  expect(text(sort)).toBe('Recently updated');
  await press(sort);
  const options = $$<HTMLElement>('[role="menuitemradio"]');
  expect(options.map(text)).toEqual(['Recently updated', 'Oldest', 'Title', 'Backlog priority']);
  await settle(() => options[1]!.click());
  expect(rows()).toEqual(['I_sample04', 'I_sample03', 'I_sample01', 'I_sample02']);
  await press($('[data-list-modal] button.sort')!);
  await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());
  expect(rows()).toEqual(['I_sample01', 'I_sample03', 'I_sample04', 'I_sample02']);
});

test('an item opens the item dialog over the List modal, and closing it comes back to the List as it was', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-server').click());
  await type('a');
  await press($('[data-list-modal] button.sort')!);
  await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());
  const before = rows();
  const row = $<HTMLButtonElement>('[data-list-modal] button[data-item="I_sample01"]')!;
  row.focus();
  await settle(() => row.click());
  expect($('[data-item-dialog]'), 'the item dialog is open').not.toBeNull();
  expect(modal(), 'the List modal stays under it').not.toBeNull();
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('[data-item-dialog]')).toBeNull();
  expect(active()).toEqual(['lar-server']);
  expect(search().value).toBe('a');
  expect(text($('[data-list-modal] button.sort'))).toBe('Title');
  expect(rows()).toEqual(before);
  expect(document.activeElement, 'focus goes back to the row').toBe(row);
});

test('closing the item dialog of an item that left List meanwhile puts focus on the List\'s search', async () => {
  await mountPage();
  await open();
  const row = $<HTMLButtonElement>('[data-list-modal] button[data-item="I_sample01"]')!;
  row.focus();
  await settle(() => row.click());
  await push(moved('I_sample01', 'Queued'));
  expect(row.isConnected, 'its row is gone').toBe(false);
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('[data-item-dialog]')).toBeNull();
  expect(modal(), 'the List stays open').not.toBeNull();
  expect(document.activeElement).toBe(search());
});

test('Add item looks as it does in the title bar: the List modal\'s Main action, with the same icon', async () => {
  await mountPage();
  await open();
  const add = $('[data-list-modal] button.add-item')!;
  expect(add.getAttribute('data-kind')).toBe('main');
  expect(add.querySelector('svg')!.outerHTML).toBe($('.title-bar button.add-item svg')!.outerHTML);
});

test('Add item opens the Add item flow over the List modal, and closing it hands focus back to Add item', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  const add = $<HTMLButtonElement>('[data-list-modal] button.add-item')!;
  add.focus();
  await settle(() => add.click());
  expect($('#add-item-dialog'), 'Add item is open').not.toBeNull();
  expect(modal(), 'the List modal stays under it').not.toBeNull();
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('#add-item-dialog')).toBeNull();
  expect(active()).toEqual(['lar-apple']);
  expect(document.activeElement, 'focus goes back to Add item').toBe(add);
});

test('the List\'s items sit in the copied Modal.Body, which fades at its scrolled edges', async () => {
  await mountPage();
  await open();
  expect($('[data-list-modal] [data-slot="modal-body"]')!.className).toContain('mask-image');
});

test('Azure List defaults to backlog priority and retains native work item fields alongside factory status', async () => {
  const azure = { type: 'Product Backlog Item', state: 'Committed', assignee: 'Ana Silva' };
  const data = { ...sample, items: sample.items.filter((item) => item.id === 'I_sample01' || item.id === 'I_sample02').map((item, i) => ({ ...item, azure, sourceOrder: i })) };
  await mountPage(data);
  await open();
  expect(text($('[data-list-modal] button.sort'))).toBe('Backlog priority');
  expect(rows()).toEqual(['I_sample01', 'I_sample02']);
  expect(text($('[data-list-modal] [data-azure]'))).toBe('Product Backlog Item · Committed · Ana Silva');
});

test('List expands below the header and restores its search', async () => {
  await mountPage();
  await open();
  await type('sample');
  await settle(() => $<HTMLButtonElement>('[data-list-modal] button[aria-label="Expand"]')!.click());
  expect((modal() as HTMLElement).style.top).toBe('52px');
  expect((modal() as HTMLElement).style.height).toBe('calc(100dvh - (52px + 1rem))');
  await settle(() => $<HTMLButtonElement>('[data-list-modal] button[aria-label="Restore size"]')!.click());
  expect(search().value).toBe('sample');
});

test('a child copies List size once and owns the expansion shortcut', async () => {
  localStorage.setItem('lar-board:match-list-size', '1');
  try {
    await mountPage();
    await open();
    await settle(() => $<HTMLButtonElement>('[data-list-modal] button[aria-label="Expand"]')!.click());
    await settle(() => $<HTMLButtonElement>('[data-list-modal] button.add-item')!.click());
    const dialogs = $$<HTMLElement>('[role="dialog"]');
    const child = dialogs.at(-1)!;
    expect(child.style.top).toBe('52px');
    await settle(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', shiftKey: true, ctrlKey: true, metaKey: true, bubbles: true })));
    expect(child.style.top).toBe('');
    expect((modal() as HTMLElement).style.top).toBe('52px');
    await closeTop();
    expect((modal() as HTMLElement).style.top).toBe('52px');
  } finally {
    localStorage.removeItem('lar-board:match-list-size');
  }
});

test('the saved List opening preference applies each time while permitting Restore', async () => {
  localStorage.setItem('lar-board:open-list-expanded', '1');
  try {
    await mountPage();
    await open();
    expect((modal() as HTMLElement).style.top).toBe('52px');
    await settle(() => $<HTMLButtonElement>('[data-list-modal] button[aria-label="Restore size"]')!.click());
    expect((modal() as HTMLElement).style.top).toBe('');
    await closeTop();
    await open();
    expect((modal() as HTMLElement).style.top).toBe('52px');
  } finally {
    localStorage.removeItem('lar-board:open-list-expanded');
  }
});

for (const match of [false, true]) {
  for (const listExpanded of [false, true]) {
    for (const childKind of ['item', 'add'] as const) {
      test(`${childKind} opens over ${listExpanded ? 'expanded' : 'collapsed'} List with matching ${match ? 'on' : 'off'}`, async () => {
        localStorage.setItem('lar-board:match-list-size', match ? '1' : '0');
        try {
          await mountPage();
          await open();
          if (listExpanded) await settle(() => $<HTMLButtonElement>('[data-list-modal] button[aria-label="Expand"]')!.click());
          const opener = childKind === 'item' ? '[data-list-modal] button[data-item]' : '[data-list-modal] button.add-item';
          await settle(() => $<HTMLButtonElement>(opener)!.click());
          const child = $$<HTMLElement>('[role="dialog"]').at(-1)!;
          expect(child.style.top).toBe(match && listExpanded ? '52px' : '');
        } finally {
          localStorage.removeItem('lar-board:match-list-size');
        }
      });
    }
  }
}

test('a List row shows a kind disagreement beside its kind badge', async () => {
  const kindDisagreement: KindDisagreement = { ticketKind: 'bug', changed: 'item', kept: false, swap: { add: [], remove: [], type: null } };
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample01' ? { ...i, kindDisagreement } : i)) });
  await open();
  expect(text($('[data-list-modal] button[data-item="I_sample01"] [data-kind-marker]'))).toBe('Bug');
});

test('a List row shows its coloured kind badge and label chips', async () => {
  await mountPage();
  await open();
  const row = (id: string) => $(`[data-list-modal] button[data-item="${id}"]`)!;
  expect(text(row('I_sample01').querySelector('[data-kind-badge]'))).toBe('Feature');
  const chips = [...row('I_sample01').querySelectorAll<HTMLElement>('[data-label-chip]')];
  expect(chips.map(text)).toEqual(['area: server', 'area: web']);
  expect(chips[0]!.style.backgroundColor).toContain('color-mix');
});

test("a third tracker's labels show as chips in its colours, leaving out the factory's own", async () => {
  await mountPage({ ...sample, items: sample.items.map((item) => (item.id === 'I_sample01' ? { ...item, repo: 'third/tracker', labels: ['linked-work', 'shiny'], labelColors: { shiny: '#123456' } } : item)) });
  await open();
  const chips = [...$('[data-list-modal] button[data-item="I_sample01"]')!.querySelectorAll<HTMLElement>('[data-label-chip]')];
  expect(chips.map(text)).toEqual(['shiny']);
  expect(chips[0]!.style.backgroundColor).toContain('rgb(18, 52, 86)');
});

describe('project icons', () => {
  const REPO = 'maddec01/lar-server';
  const favicon = { kind: 'favicon', projectId: 'project:one', revision: 'abc123' } as const;
  const icon = (name: string) => group(name).querySelector<HTMLElement>('[data-project-icon]')!;
  const image = (name: string) => icon(name).querySelector('img');
  const fire = (el: Element, type: string) => settle(() => el.dispatchEvent(new Event(type)));

  test('a favicon from the board\'s endpoint shows over the toned initial once it loads, in a square that keeps its size', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO]: favicon } });
    await open();
    const square = icon('lar-server');
    const classes = square.className;
    expect(text(square)).toBe('L');
    expect(classes).toContain('size-5');
    expect(square.getAttribute('aria-hidden')).toBe('true');
    const img = image('lar-server')!;
    expect(img.getAttribute('src')).toBe('/api/project-icon/project%3Aone?v=abc123');
    expect(img.alt).toBe('');
    expect(img.hidden, 'held back until it loads').toBe(true);
    await fire(img, 'load');
    expect(img.hidden).toBe(false);
    expect(img.className).toContain('absolute');
    expect(icon('lar-server').className, 'the image is out of flow, so the square does not move').toBe(classes);
    expect(text(icon('lar-server'))).toBe('L');
  });

  test('an image the browser can\'t decode is dropped, leaving the toned initial', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO]: favicon } });
    await open();
    await fire(image('lar-server')!, 'error');
    expect(image('lar-server')).toBeNull();
    expect(text(icon('lar-server'))).toBe('L');
  });

  test('a new revision tries the image again', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO]: favicon } });
    await open();
    await fire(image('lar-server')!, 'error');
    await push({ ...sample, projectIcons: { [REPO]: { ...favicon, revision: 'def456' } } });
    expect(image('lar-server')!.getAttribute('src')).toBe('/api/project-icon/project%3Aone?v=def456');
    expect(image('lar-server')!.hidden).toBe(true);
  });

  test('a repository with no icon shows the toned initial', async () => {
    await mountPage({ ...sample, projectIcons: {} });
    await open();
    for (const name of ['lar-server', 'lar-apple']) {
      expect(image(name)).toBeNull();
      expect(text(icon(name))).toBe('L');
      expect(icon(name).className).toMatch(/repo-tone-\d/);
    }
  });

  test('an emoji shows in the square, in place of the initial and with no color', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO]: { kind: 'emoji', emoji: '🚀' } } });
    await open();
    expect(text(icon('lar-server'))).toBe('🚀');
    expect(icon('lar-server').className).toContain('size-5');
    expect(icon('lar-server').className).not.toMatch(/repo-tone-|text-white/);
    expect(image('lar-server')).toBeNull();
  });

  test('a monogram shows its first two graphemes in its T3 color', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO]: { kind: 'monogram', text: 'e\u0301xyz', color: 'rose' } } });
    await open();
    expect(text(icon('lar-server'))).toBe('e\u0301x');
    expect(icon('lar-server').className).toContain('text-rose-500');
    expect(icon('lar-server').className).not.toMatch(/repo-tone-|text-white/);
    expect(image('lar-server')).toBeNull();
  });

  describe('a lucide icon', () => {
    const lucide = { kind: 'lucide', name: 'git-branch', color: 'sky' } as const;
    const svg = () => icon('lar-server').querySelector('svg');
    /** Lets the real chunk imports finish, which takes more than React's own settling and far longer during a full suite run. */
    const until = (check: () => void) => vi.waitFor(async () => { await settle(); check(); }, { timeout: 12_000 });

    afterEach(() => { vi.doUnmock('lucide-react/dynamic'); });

    test('shows in its T3 color over the toned initial once its chunk loads, in a square that keeps its size', async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      vi.doMock('lucide-react/dynamic', async (importOriginal) => {
        await held;
        return importOriginal();
      });
      await mountPage({ ...sample, projectIcons: { [REPO]: lucide } });
      await open();
      const classes = icon('lar-server').className;
      expect(text(icon('lar-server')), 'the initial shows while the chunk loads').toBe('L');
      expect(classes).toMatch(/repo-tone-\d/);
      expect(svg()).toBeNull();
      release();
      await until(() => expect(svg()).not.toBeNull());
      expect(svg()!.getAttribute('class')).toContain('text-sky-500');
      expect(svg()!.getAttribute('class')).toContain('absolute');
      expect(icon('lar-server').className).toBe(classes);
      expect(image('lar-server')).toBeNull();
    });

    test('a name lucide doesn\'t have leaves the toned initial', async () => {
      const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
      await mountPage({ ...sample, projectIcons: { [REPO]: { ...lucide, name: 'not-a-lucide-icon' } } });
      await open();
      await until(() => expect(failure).toHaveBeenCalled());
      expect(svg()).toBeNull();
      expect(text(icon('lar-server'))).toBe('L');
      failure.mockRestore();
    });

    test('a chunk that fails to load leaves the toned initial', async () => {
      vi.doMock('lucide-react/dynamic', () => Promise.reject(new Error('chunk failed')));
      await mountPage({ ...sample, projectIcons: { [REPO]: lucide } });
      await open();
      await settle();
      expect(svg()).toBeNull();
      expect(text(icon('lar-server'))).toBe('L');
      expect($('[data-list-modal]'), 'the failure stays inside the square').not.toBeNull();
    });
  });

  test('an item row that names its repository shows its icon, whatever the case of its key', async () => {
    await mountPage({ ...sample, projectIcons: { [REPO.toUpperCase()]: favicon } });
    await open();
    const row = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').find((b) => b.textContent.includes('lar-server'))!;
    const small = row().querySelector<HTMLElement>('[data-project-icon]')!;
    expect(small.className).toContain('size-3.5');
    expect(small.querySelector('img')!.getAttribute('src')).toBe('/api/project-icon/project%3Aone?v=abc123');
    await settle(() => group('lar-server').click());
    expect($$('[data-list-modal] button[data-item] [data-project-icon]'), 'a picked repository\'s rows name no repository').toEqual([]);
  });
});
