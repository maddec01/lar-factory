// @vitest-environment jsdom
import { act, createElement, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { SearchDialog, type SearchDialogProps, SearchDialogGroup, useSearchDialogOption } from './search-dialog.tsx';

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

function Option({ value }: { value: string }) {
  return createElement('div', useSearchDialogOption(value), value);
}

const element = (props: Partial<SearchDialogProps>) => {
  const options = props.options ?? ['Add item', 'Settings', 'Archive'];
  return createElement(SearchDialog, {
    label: 'Search the board',
    description: 'Find tickets and set filters',
    placeholder: 'Search',
    listLabel: 'Results',
    query: '',
    onQueryChange: () => undefined,
    onSelect: () => undefined,
    onClose: () => undefined,
    ...props,
    options,
    children: createElement(SearchDialogGroup, { label: 'Actions', children: options.map((value) => createElement(Option, { key: value, value })) }),
  });
};

const show = async (node: ReactNode) => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(node));
};
const rerender = (node: ReactNode) => act(async () => root!.render(node));

const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
});
const active = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.textContent;
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

test('opens as a labelled dialog with no heading, focuses the field and reports typing', async () => {
  const onQueryChange = vi.fn();
  await show(element({ onQueryChange }));

  const dialog = document.querySelector('[role="dialog"]')!;
  expect([...dialog.querySelectorAll('h2')].map((heading) => heading.className)).toEqual(['sr-only']);
  expect(input().getAttribute('aria-label')).toBe('Search the board');
  expect(input().placeholder).toBe('Search');
  expect(document.activeElement).toBe(input());
  expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Results');
  expect(document.querySelector('[role="group"]')?.textContent).toContain('Actions');

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), 'arc');
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(onQueryChange).toHaveBeenCalledWith('arc');
});

test("its overlay is a child of the body that the page's animation pause selector matches", async () => {
  await show(element({}));
  const overlay = document.querySelector("[data-slot$='-overlay'][data-state='open']");
  expect(overlay?.parentElement).toBe(document.body);
  expect(host!.compareDocumentPosition(overlay!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the arrow keys move the highlight, wrap at both ends and scroll it into view', async () => {
  await show(element({}));
  expect(active()).toBe('Add item');

  await press('ArrowUp');
  expect(active()).toBe('Archive');
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toBe('Archive');
  expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(document.querySelector('[aria-selected="true"]'));

  await press('ArrowDown');
  expect(active()).toBe('Add item');
  await press('ArrowDown');
  expect(active()).toBe('Settings');
  expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
});

test('Enter chooses the highlighted option, and does nothing with an empty list', async () => {
  const onSelect = vi.fn();
  await show(element({ onSelect }));
  await press('ArrowDown');
  await press('Enter');
  expect(onSelect.mock.calls).toEqual([['Settings']]);

  await rerender(element({ onSelect, options: [] }));
  await press('Enter');
  await press('ArrowDown');
  expect(onSelect).toHaveBeenCalledOnce();
  expect(input().hasAttribute('aria-activedescendant')).toBe(false);
});

test('Esc and the Close button close it', async () => {
  const onClose = vi.fn();
  await show(element({ onClose }));
  await press('Escape');
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => button('Close').click());
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('Backspace calls back in an empty query and does nothing otherwise', async () => {
  const onBackspaceEmpty = vi.fn();
  await show(element({ onBackspaceEmpty }));
  await press('Backspace');
  expect(onBackspaceEmpty).toHaveBeenCalledOnce();

  await rerender(element({ onBackspaceEmpty, query: 'a' }));
  await press('Backspace');
  expect(onBackspaceEmpty).toHaveBeenCalledOnce();
});

test('no key acts during IME composition', async () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onBackspaceEmpty = vi.fn();
  await show(element({ onSelect, onClose, onBackspaceEmpty }));
  for (const key of ['ArrowDown', 'Enter', 'Backspace', 'Escape']) await press(key, { isComposing: true });
  expect(active()).toBe('Add item');
  expect(onSelect).not.toHaveBeenCalled();
  expect(onBackspaceEmpty).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('a token shows its content, and its remove button has its own name and returns focus to the field', async () => {
  const onRemove = vi.fn();
  await show(element({
    tokens: [
      { id: 'repo', label: 'lar-factory' },
      { id: 'bug', label: 'bug', leading: createElement('i', { 'data-testid': 'colour' }), remove: { label: 'Remove label bug', onRemove } },
    ],
    trailing: createElement('button', { type: 'button' }, 'Clear'),
  }));

  expect(document.querySelectorAll('li')).toHaveLength(2);
  expect(document.querySelector('li')?.querySelector('button')).toBeNull();
  expect(document.querySelector('[data-testid="colour"]')?.closest('li')?.textContent).toBe('bug');
  expect([...document.querySelectorAll('[role="dialog"] button')].some((item) => item.textContent === 'Clear')).toBe(true);

  button('Remove label bug').focus();
  await act(async () => button('Remove label bug').click());
  expect(onRemove).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(input());
});

test('the highlight moves to the first option when the active option leaves the list', async () => {
  await show(element({}));
  await press('ArrowUp');
  expect(active()).toBe('Archive');

  await rerender(element({ options: ['Add item', 'Settings'] }));
  expect(active()).toBe('Add item');

  await press('ArrowDown');
  await rerender(element({ options: ['Archive', 'Settings'] }));
  expect(active()).toBe('Settings');
});

test('an option follows the pointer and a click chooses it with the focus left in the field', async () => {
  const onSelect = vi.fn();
  await show(element({ onSelect }));
  const settings = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'Settings')!;

  await act(async () => settings.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })));
  expect(active()).toBe('Settings');

  const pressed = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  await act(async () => settings.dispatchEvent(pressed));
  expect(pressed.defaultPrevented).toBe(true);
  await act(async () => settings.click());
  expect(onSelect.mock.calls).toEqual([['Settings']]);
});

test('values that differ only in punctuation get separate option ids', async () => {
  await show(element({ options: ['a b', 'a_b'] }));
  await press('ArrowDown');
  expect(active()).toBe('a_b');
  expect(input().getAttribute('aria-activedescendant')).not.toContain(' ');
});

test('empty content shows only with nothing listed and nothing pending', async () => {
  await show(element({ options: [], empty: 'Nothing matches' }));
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Nothing matches');
  expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('false');

  await rerender(element({ options: ['Settings'], empty: 'Nothing matches' }));
  expect(document.querySelector('[role="status"]')?.textContent).toBe('');

  await rerender(element({ options: [], empty: 'Nothing matches', busy: 'Loading tickets' }));
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading tickets');
});

test('busy content shows beside listed options and marks the list busy', async () => {
  await show(element({ options: ['Settings'], busy: 'Loading tickets' }));
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading tickets');
  expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('true');
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
});

test('the footer holds the key hints', async () => {
  await show(element({ footer: 'Arrow keys to move' }));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Arrow keys to move');
  expect(document.querySelector('[role="listbox"]')?.textContent).not.toContain('Arrow keys to move');
});
