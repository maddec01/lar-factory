// In the Mac app the page draws T3 Code's title bar above the header: a drag bar with the logo,
// "Factory" and the "for T3 Code" pill. Outside the app (a browser, `pnpm run sample`) it draws none.

import { expect, test, vi } from 'vite-plus/test';
import { $, mountPage, sample } from './support.ts';

const titleBar = () => $<HTMLElement>('.title-bar');

test('in the Mac app, the page shows the title bar above the header', async () => {
  vi.stubGlobal('boardApp', { platform: 'darwin', secret: 'launch-secret' });
  await mountPage();
  expect(titleBar()?.textContent).toBe('Factoryfor T3 Code');
  expect(titleBar()?.querySelector('a, button')).toBeNull();
  // Screen readers skip the bar; the header's hidden h1 names the page.
  expect(titleBar()!.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(titleBar()!.compareDocumentPosition($('header.top')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('the title bar also tops the missing-t3 notice', async () => {
  vi.stubGlobal('boardApp', { platform: 'darwin' });
  await mountPage({ ...sample, tools: { t3: { problem: 'missing' } } });
  expect(titleBar()).not.toBeNull();
});

test('outside the app, the page shows no title bar', async () => {
  await mountPage();
  expect(titleBar()).toBeNull();
  expect($('header.top')).not.toBeNull();
});
