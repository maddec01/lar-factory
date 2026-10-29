// The description editor: Markdown shortcuts as you type, pasted Markdown, the toolbar, and the Markdown it reports.

import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { TooltipProvider } from '@lar-factory/ui/design-system/Tooltip';
import { DescriptionEditor } from './description-editor.tsx';
import { pastePlain, selectAll, selectEnd, typeInto } from '../../test/editor.ts';

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

/** Mounts an editor starting from `value`; `markdown()` is the Markdown it last reported, `baseline()` the Markdown it
 *  made of `value`. */
async function mount(value = '', format: 'markdown' | 'html' = 'markdown') {
  const onChange = vi.fn<(markdown: string) => void>();
  const onBaseline = vi.fn<(markdown: string) => void>();
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(TooltipProvider, null,
    createElement(DescriptionEditor, { value, format, onChange, onBaseline, label: 'Description', placeholder: 'Add a description…' }))));
  const area = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
  const press = (label: string) => act(async () => button(label).click());
  return { area, button, press, markdown: () => onChange.mock.calls.at(-1)?.[0], baseline: () => onBaseline.mock.calls };
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

test('it reports the Markdown it makes of its starting text once, before any edit', async () => {
  const { area, baseline } = await mount('Some **text**\n\n\n\nmore');
  expect(baseline()).toEqual([['Some **text**\n\nmore']]);
  await typeInto(area, '!');
  expect(baseline()).toHaveLength(1);
});

test('it opens HTML as the nodes it stands for and reports Markdown', async () => {
  const { area, markdown, baseline } = await mount('<p>Steps:</p><ul><li><b>Play</b></li><li>Quit</li></ul>', 'html');
  expect([...area.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['Play', 'Quit']);
  expect(baseline()).toEqual([['Steps:\n\n- **Play**\n- Quit']]);
  await selectEnd(area);
  await typeInto(area, '!');
  expect(markdown()).toBe('Steps:\n\n- **Play**\n- Quit!');
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

test('Tab indents a list item and Shift+Tab outdents it; elsewhere Tab moves focus on', async () => {
  const { area, markdown } = await mount();
  const tab = async (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    await act(async () => { area.dispatchEvent(event); });
    return event.defaultPrevented;
  };
  await typeInto(area, 'text');
  expect(await tab(), 'in a paragraph Tab is the browser\'s').toBe(false);
  expect(await tab(true)).toBe(false);
  expect(markdown()).toBe('text');
  await typeInto(area, '\n- a\nb');
  expect(await tab()).toBe(true);
  expect(area.querySelector('ul ul > li')?.textContent).toBe('b');
  expect(await tab(), 'an item nests one deeper than the one before it at most, so Tab moves on').toBe(false);
  expect(await tab(true)).toBe(true);
  expect(area.querySelector('ul ul')).toBeNull();
  expect(await tab(true), 'a top-level item cannot outdent, so Shift+Tab moves on').toBe(false);
  expect(markdown()).toBe('text\n\n- a\n- b');
});

test('Markdown pasted at the end of a list item that starts with a block goes in after it, not into the item', async () => {
  const { area, markdown } = await mount();
  await typeInto(area, '- a\nb');
  await pastePlain(area, '## Pasted\n\nmore');
  expect([...area.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
  expect(area.querySelector('h2')!.textContent).toBe('Pasted');
  expect(markdown()).toBe('- a\n- b\n\n## Pasted\n\nmore');
  await typeInto(area, '!');
  expect(markdown(), 'the caret ends after the pasted text').toBe('- a\n- b\n\n## Pasted\n\nmore!');
});

test('Markdown pasted over selected text replaces it', async () => {
  const { area, markdown } = await mount();
  await typeInto(area, 'replace me');
  await selectAll(area);
  await pastePlain(area, '- a\n- b');
  expect(markdown()).toBe('- a\n- b');
  expect(area.textContent).not.toContain('replace me');
});

test('the Link button itself says it opens the URL field, and the field\'s Apply button links the selection', async () => {
  const { area, button, press, markdown } = await mount();
  await typeInto(area, 'word');
  expect([button('Link').getAttribute('aria-haspopup'), button('Link').getAttribute('aria-expanded')]).toEqual(['dialog', 'false']);
  await selectAll(area);
  await press('Link');
  expect(button('Link').getAttribute('aria-expanded')).toBe('true');
  urlField()!.value = 'https://example.com';
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!.click());
  expect(urlField()).toBeNull();
  expect(markdown()).toBe('[word](https://example.com)');
});

test('the Link tooltip hides while the URL field is open, even with the pointer back on the button', async () => {
  const { area, button, press } = await mount();
  await typeInto(area, 'word');
  await selectAll(area);
  const tip = () => [...document.querySelectorAll('[data-slot="tooltip-content"]')].find((el) => el.firstChild?.textContent === 'Link');
  await press('Link');
  expect(urlField()).not.toBeNull();
  // The pointer leaves for the field and comes back to the button, which hover would show the tooltip for.
  await act(async () => {
    button('Link').dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }));
    button('Link').dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 800));
  });
  expect(urlField()).not.toBeNull();
  expect(tip(), 'hidden while the field is open').toBeUndefined();
});
