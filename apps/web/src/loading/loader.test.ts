import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vite-plus/test';
import { Loader } from './loader.tsx';

test("the loader's own inline row keeps its spinner beside its label", () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(Loader, { label: 'Loading projects…' }));
  const row = host.querySelector('[data-loader]')!;
  expect(row.classList.contains('inline-flex')).toBe(true);
  expect(row.firstElementChild!.classList.contains('motion-safe:animate-spin')).toBe(true);
  expect(row.textContent).toBe('Loading projects…');
});
