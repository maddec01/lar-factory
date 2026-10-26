// The onboarding dialog: 768px wide over the board, a scrolling body, the progress bar, and Back and Next.

import { expect, test } from 'vite-plus/test';
import { $, settle, text } from '../../test/support.ts';
import { dialog, openOnboarding, project } from './onboarding-support.ts';

const inDialog = <T extends HTMLElement = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim() === label);
const radio = (name: string) => [...dialog()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => text(r.closest('label')).startsWith(name))!;

test('the dialog is 768px wide with a scrolling body, the step, its place and the progress bar', async () => {
  await openOnboarding([project('lar-web')]);
  expect(dialog()!.classList.contains('max-w-3xl'), '48rem is 768px').toBe(true);
  expect(inDialog('[data-slot="dialog-panel"]')).not.toBeNull();
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('T3 project');
  expect(text(inDialog('[data-slot="dialog-description"]'))).toBe('Onboard a repository · step 1 of 4');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
});

test('Next is disabled until a project is picked, then shows the next step, and Back returns', async () => {
  await openOnboarding([project('lar-web')]);
  expect(button('Back'), 'the first step has no Back').toBeUndefined();
  expect(button('Next')!.disabled).toBe(true);
  await settle(() => radio('lar-web').click());
  expect(button('Next')!.disabled).toBe(false);
  await settle(() => button('Next')!.click());
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('Provider and item source');
  expect(text(inDialog('[data-slot="dialog-description"]'))).toBe('Onboard lar-web · step 2 of 4');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('1');
  expect(button('Next')!.disabled, 'the step waits for its answers').toBe(true);
  await settle(() => button('Back')!.click());
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('T3 project');
  expect(radio('lar-web').getAttribute('aria-checked'), 'the pick stays').toBe('true');
});

test('Onboard a repository after a close starts a new run', async () => {
  await openOnboarding([project('lar-web')]);
  await settle(() => radio('lar-web').click());
  await settle(() => inDialog<HTMLButtonElement>('[aria-label="Close"]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  expect(useWizardStore.getState().run).toBeNull();
  await settle(() => $<HTMLButtonElement>('[data-onboard]')!.click());
  expect(radio('lar-web').getAttribute('aria-checked')).toBe('false');
});
