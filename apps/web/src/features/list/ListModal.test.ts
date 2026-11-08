// The List modal: the title bar's List button opens it, the left pane picks All, a repository, the right
// pane shows that group's items with search, Add item, Scope board and the sort menu.

import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { $, $$, moved, mountPage, push, sample, settle, text } from '@/test/PageTest';

afterEach(() => {
    delete (Element.prototype as Partial<Element>).getAnimations;
});

const listButton = () => $<HTMLButtonElement>('.title-bar button.list-button')!;
const modal = () => $('[role="dialog"][data-list-modal]');
const groups = () => $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Projects"] button');
const group = (name: string) => groups().find((b) => b.querySelector('.name')?.textContent === name)!;
const counts = () => groups().map((b) => [text(b.querySelector('.name')), text(b.querySelector('.count'))]);
const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);
const search = () => $<HTMLInputElement>('[data-list-modal] input[type="search"]')!;
const open = () => settle(() => listButton().click());
const active = () =>
    groups()
        .filter((b) => b.getAttribute('aria-current') === 'page')
        .map((b) => text(b.querySelector('.name')));
const closeTop = () =>
    settle(() => $$<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]').at(-1)!.click());

async function type(value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
    await settle(() => search().dispatchEvent(new Event('input', { bubbles: true })));
}

/** Opens a Radix menu trigger the way a pointer does. */
const press = (el: Element) =>
    settle(() => {
        el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

test('choosing a repository in the left pane shows only its items on the right', async () => {
    await mountPage();
    await open();
    expect(rows()).toEqual(['I_sample02', 'I_sample01', 'I_sample03', 'I_sample04']);
    await settle(() => group('lar-apple').click());
    expect(rows()).toEqual(['I_sample03']);
    expect(group('lar-apple').getAttribute('aria-current')).toBe('page');
    await settle(() => group('All projects').click());
    expect(rows()).toHaveLength(4);
});

test('the repositories go by their items in the list, most first, whatever the config’s order', async () => {
    await mountPage({ ...sample, repos: [...sample.repos].reverse() });
    await open();
    expect(counts()).toEqual([
        ['All projects', '4'],
        ['lar-server', '3'],
        ['lar-apple', '1'],
    ]);
    // The order holds while the search changes the counts.
    await type('subtitle');
    expect(counts().map(([name]) => name)).toEqual(['All projects', 'lar-server', 'lar-apple']);
});

test('the list modal starts on the board’s scope', async () => {
    await mountPage();
    await open();
    await settle(() => group('lar-apple').click());
    await settle(() => $<HTMLButtonElement>('[data-list-modal] button[data-scope-board]')!.click());
    await closeTop();
    await open();
    expect(active()).toEqual(['lar-apple']);
    expect(rows()).toEqual(['I_sample03']);
});

test('All projects keeps a loading cue and no count under the rows that landed until the first read settles', async () => {
    const reading = {
        ...sample,
        items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
        firstRead: { step: 'items' as const, running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false },
    };

    await mountPage(reading);
    await open();

    const header = () => text($('[data-list-modal] span.sort')!.parentElement);

    expect(rows().length).toBeGreaterThan(0);
    expect(text($('[data-list-modal] [data-reading]'))).toBe('Loading more Projects…');
    expect($('[data-list-modal] [data-reading] [data-loader]')).not.toBeNull();
    expect(header(), 'no final-looking count').not.toMatch(/All projects\d/);
    expect(
        counts().find(([name]) => name === 'All projects'),
        'none in the left pane either',
    ).toEqual(['All projects', '']);
    await push({ ...sample, firstRead: { step: 'finishing', running: [], settled: true } });
    expect($('[data-list-modal] [data-reading]')).toBeNull();
    expect(header()).toMatch(/All projects\d/);
    expect(counts()[0]).toEqual(['All projects', '4']);
});

test('the search filters the right pane and the counts on the left follow it', async () => {
    await mountPage();
    await open();
    await type('subtitle');
    expect(rows()).toEqual(['I_sample03']);
    expect(counts()).toEqual([
        ['All projects', '1'],
        ['lar-server', '0'],
        ['lar-apple', '1'],
    ]);
    await settle(() => group('lar-server').click());
    expect(rows()).toEqual([]);
    expect(text($('[data-list-modal]'))).toContain('Nothing matches');

    const clear = [...$('[data-list-modal]')!.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => text(button) === 'Clear search',
    )!;

    await settle(() => clear.click());
    expect(rows().length).toBeGreaterThan(0);
});

test('Scope board scopes the board to the chosen repository, and is only there for a repository', async () => {
    await mountPage();
    await open();

    const scope = () => $<HTMLButtonElement>('[data-list-modal] button[data-scope-board]');

    expect(scope()).toBeNull();
    await settle(() => group('lar-apple').click());
    expect(text(scope())).toBe('Scope board');
    await settle(() => scope()!.click());
    expect($('[data-search-field]')!.getAttribute('aria-description')).toBe('filtered by lar-apple');
    expect(scope()!.getAttribute('aria-pressed')).toBe('true');
    expect(text(scope())).toBe('Board scoped');
    await settle(() => scope()!.click());
    expect($('[data-search-field]')!.getAttribute('aria-description')).toBeNull();
    expect(text(scope())).toBe('Scope board');
});

test('the sort menu reorders the items', async () => {
    await mountPage();
    await open();

    const sort = $<HTMLButtonElement>('[data-list-modal] .sort button')!;

    expect(text(sort)).toBe('Recently updated');
    await press(sort);

    const options = $$<HTMLElement>('[role="menuitemradio"]');

    expect(options.map(text)).toEqual(['Recently updated', 'Oldest', 'Title', 'Backlog priority']);
    await settle(() => options[1]!.click());
    expect(rows()).toEqual(['I_sample04', 'I_sample03', 'I_sample01', 'I_sample02']);
    await press($('[data-list-modal] .sort button')!);
    await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());
    expect(rows()).toEqual(['I_sample01', 'I_sample03', 'I_sample04', 'I_sample02']);
});

test('an item opens the item dialog over the list modal, and closing it comes back to the list as it was', async () => {
    await mountPage();
    await open();
    await settle(() => group('lar-server').click());
    await type('a');
    await press($('[data-list-modal] .sort button')!);
    await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());

    const before = rows();
    const row = $<HTMLButtonElement>('[data-list-modal] button[data-item="I_sample01"]')!;

    row.focus();
    await settle(() => row.click());
    expect($('[data-item-dialog]'), 'the item dialog is open').not.toBeNull();
    expect(modal(), 'the list modal stays under it').not.toBeNull();
    await closeTop();
    await settle(() => vi.advanceTimersByTime(500));
    expect($('[data-item-dialog]')).toBeNull();
    expect(active()).toEqual(['lar-server']);
    expect(search().value).toBe('a');
    expect(text($('[data-list-modal] .sort button'))).toBe('Title');
    expect(rows()).toEqual(before);
    expect(document.activeElement, 'focus goes back to the row').toBe(row);
});

test('closing the item dialog of an item that left List meanwhile puts focus on the list’s search', async () => {
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
    expect(modal(), 'the list stays open').not.toBeNull();
    expect(document.activeElement).toBe(search());
});

test('Add item opens the Add item flow over the list modal, and closing it hands focus back to Add item', async () => {
    await mountPage();
    await open();
    await settle(() => group('lar-apple').click());

    const add = $<HTMLButtonElement>('[data-list-modal] button[data-add-item]')!;

    add.focus();
    await settle(() => add.click());
    expect($('#add-item-dialog'), 'Add item is open').not.toBeNull();
    expect(modal(), 'the list modal stays under it').not.toBeNull();
    await closeTop();
    await settle(() => vi.advanceTimersByTime(500));
    expect($('#add-item-dialog')).toBeNull();
    expect(active()).toEqual(['lar-apple']);
    expect(document.activeElement, 'focus goes back to Add item').toBe(add);
});

test('Azure List defaults to backlog priority and retains native work item fields alongside factory status', async () => {
    const azure = { type: 'Product Backlog Item', state: 'Committed', assignee: 'Ana Silva' };
    const data = {
        ...sample,
        items: sample.items
            .filter((item) => item.id === 'I_sample01' || item.id === 'I_sample02')
            .map((item, i) => ({ ...item, azure, sourceOrder: i })),
    };

    await mountPage(data);
    await open();
    expect(text($('[data-list-modal] .sort button'))).toBe('Backlog priority');
    expect(rows()).toEqual(['I_sample01', 'I_sample02']);
    expect(text($('[data-list-modal] [data-azure]'))).toBe('Product Backlog Item · Committed · Ana Silva');
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

                    if (listExpanded)
                        await settle(() =>
                            $<HTMLButtonElement>('[data-list-modal] button[aria-label="Expand"]')!.click(),
                        );

                    const opener =
                        childKind === 'item'
                            ? '[data-list-modal] button[data-item]'
                            : '[data-list-modal] button[data-add-item]';

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

describe('project icons', () => {
    const REPO = 'maddec01/lar-server';
    const favicon = { kind: 'favicon', projectId: 'project:one', revision: 'abc123' } as const;
    const icon = (name: string) => group(name).querySelector<HTMLElement>('[data-project-icon]')!;
    const image = (name: string) => icon(name).querySelector('img');
    const fire = (el: Element, type: string) => settle(() => el.dispatchEvent(new Event(type)));

    test('an image the browser can’t decode is dropped, leaving the toned initial', async () => {
        await mountPage({ ...sample, projectIcons: { [REPO]: favicon } });
        await open();
        await fire(image('lar-server')!, 'error');
        expect(image('lar-server')).toBeNull();
        expect(text(icon('lar-server'))).toBe('L');
    });
});
