// The description editor: Markdown shortcuts as you type, pasted Markdown, the toolbar, and the Markdown it reports.

import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { TooltipProvider } from '@lar-factory/ui/design-system/Tooltip';
import { DescriptionEditor } from './description-editor.tsx';
import { pastePlain, selectAll, typeInto } from '../../test/editor.ts';

/** The Link button's URL field, while it is open. */
const urlField = () => document.querySelector<HTMLInputElement>('input[aria-label="Link URL"]');
const keyIn = (el: Element, key: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
/** Types `url` into the open URL field and presses Enter. */
async function enterUrl(url: string) {
  const field = urlField()!;
  field.value = url;
  await keyIn(field, 'Enter');
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** Mounts an editor starting from `value`; `markdown()` is the Markdown it last reported. */
async function mount(value = '') {
  const onChange = vi.fn<(markdown: string) => void>();
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(TooltipProvider, null,
    createElement(DescriptionEditor, { value, onChange, label: 'Description', placeholder: 'Add a description…' }))));
  const area = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
  const press = (label: string) => act(async () => button(label).click());
  return { area, button, press, markdown: () => onChange.mock.calls.at(-1)?.[0] };
}

test('"- " starts a bullet list, and Enter adds an item', async () => {
  const { area, markdown } = await mount();
  await typeInto(area, '- a\nb');
  expect(area.querySelectorAll('ul > li').length).toBe(2);
  expect(markdown()).toBe('- a\n- b');
});

test('"1. " starts a numbered list', async () => {
  const { area, markdown } = await mount();
  await typeInto(area, '1. a\nb');
  expect(area.querySelectorAll('ol > li').length).toBe(2);
  expect(markdown()).toBe('1. a\n2. b');
});

test('"# " starts a heading, and **bold** turns bold', async () => {
  const { area, markdown } = await mount();
  await typeInto(area, '# h');
  expect(area.querySelector('h1')!.textContent).toBe('h');
  expect(markdown()).toBe('# h');
  await typeInto(area, '\nsay **this**');
  expect(area.querySelector('p strong')!.textContent).toBe('this');
  expect(markdown()).toBe('# h\n\nsay **this**');
});

test('it starts from the Markdown it is given', async () => {
  const { area } = await mount('- one\n- two');
  expect([...area.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['one', 'two']);
});

test('pasted plain-text Markdown renders formatted', async () => {
  const { area, markdown } = await mount();
  await pastePlain(area, '## Steps\n\n1. Play\n2. Quit\n\n- **kept**');
  expect(area.querySelector('h2')!.textContent).toBe('Steps');
  expect(area.querySelectorAll('ol > li').length).toBe(2);
  expect(area.querySelectorAll('ul > li').length).toBe(1);
  expect(markdown()).toBe('## Steps\n\n1. Play\n2. Quit\n\n- **kept**');
});

test('each toolbar button applies its format and shows pressed while the selection has it', async () => {
  const { area, button, press, markdown } = await mount();
  await typeInto(area, 'word');
  // jsdom loses the selection when the text's markup changes, so each press starts by selecting the word again.
  const toggle = async (label: string) => {
    await selectAll(area);
    await press(label);
  };
  for (const [label, expected] of [['Bold', '**word**'], ['Italic', '*word*'], ['Heading', '## word'], ['Bulleted list', '- word'],
    ['Numbered list', '1. word'], ['Link', '[word](https://example.com)']] as const) {
    expect(button(label).getAttribute('aria-pressed'), label).toBe('false');
    await toggle(label);
    if (label === 'Link') await enterUrl('https://example.com');
    expect(button(label).getAttribute('aria-pressed'), label).toBe('true');
    expect(markdown()).toBe(expected);
    await toggle(label);
    expect(button(label).getAttribute('aria-pressed'), `${label} again`).toBe('false');
    expect(markdown()).toBe('word');
  }
});

test('Link opens a URL field, which Enter applies, and Escape or an empty URL closes with no link', async () => {
  const { area, button, press, markdown } = await mount();
  await typeInto(area, 'word');
  await selectAll(area);
  await press('Link');
  expect(document.activeElement, 'the field takes focus').toBe(urlField());
  await keyIn(urlField()!, 'Escape');
  expect(urlField()).toBeNull();
  expect(button('Link').getAttribute('aria-pressed')).toBe('false');
  await selectAll(area);
  await press('Link');
  await enterUrl('  ');
  expect(urlField()).toBeNull();
  expect(button('Link').getAttribute('aria-pressed')).toBe('false');
  expect(markdown()).toBe('word');
  await selectAll(area);
  await press('Link');
  await enterUrl('https://example.com');
  expect(urlField()).toBeNull();
  expect(markdown()).toBe('[word](https://example.com)');
});
