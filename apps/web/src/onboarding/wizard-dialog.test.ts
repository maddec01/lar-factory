// The onboarding dialog: 768px wide over the board, a scrolling body, the progress bar, and Back and Next.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, OnboardingRepository, SetupAnswers } from '@lar-factory/shared';
import { $, mountPage, sample, settle, text } from '../../test/support.ts';
import { dialog, empty, openOnboarding, project, serve } from './onboarding-support.ts';

const inDialog = <T extends HTMLElement = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const button = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim() === label);
const radio = (name: string) => [...dialog()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => text(r.closest('label')).startsWith(name))!;

test('the dialog is 768px wide with a scrolling body, the step, its place and the progress bar', async () => {
  await openOnboarding([project('lar-web')]);
  expect(dialog()!.classList.contains('max-w-3xl'), '48rem is 768px').toBe(true);
  expect(inDialog('[data-slot="dialog-panel"]')).not.toBeNull();
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('T3 project');
  expect(text(inDialog('[data-slot="dialog-description"]'))).toBe('Onboard a repository · step 1 of 6');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-label'), 'the bar is named by its caption').toBe('0 of 6 done');
});

test('Next is disabled until a project is picked, then shows the next step, and Back returns', async () => {
  await openOnboarding([project('lar-web')]);
  expect(button('Back'), 'the first step has no Back').toBeUndefined();
  expect(button('Next')!.disabled).toBe(true);
  await settle(() => radio('lar-web').click());
  expect(button('Next')!.disabled).toBe(false);
  await settle(() => button('Next')!.click());
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('Provider and item source');
  expect(text(inDialog('[data-slot="dialog-description"]'))).toBe('Onboard lar-web · step 2 of 6');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('1');
  expect(button('Next')!.disabled, 'the step waits for its answers').toBe(true);
  await settle(() => button('Back')!.click());
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('T3 project');
  expect(radio('lar-web').getAttribute('aria-checked'), 'the pick stays').toBe('true');
});

test('a run that reuses its .lar-factory.json counts the Pull request step too', async () => {
  await openOnboarding([project('lar-web', { hasConfig: true, config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client', labels: [] } })]);
  await settle(() => radio('lar-web').click());
  await settle(() => button('Next')!.click());
  expect(text(inDialog('[data-slot="dialog-description"]'))).toBe('Onboard lar-web · step 2 of 6');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-valuemax')).toBe('6');
  expect(inDialog('[role="progressbar"]')!.getAttribute('aria-label')).toBe('1 of 6 done');
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

test('Next and Back move focus to the step heading, and closing returns it to the button that opened the dialog', async () => {
  serve(empty, [project('lar-web')]);
  await mountPage(empty);
  const onboard = $<HTMLButtonElement>('[data-onboard]')!;
  onboard.focus();
  await settle(() => onboard.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => radio('lar-web').click());
  await settle(() => button('Next')!.click());
  expect(document.activeElement, 'Next').toBe(inDialog('[data-slot="dialog-title"]'));
  await settle(() => button('Back')!.click());
  expect(document.activeElement, 'Back').toBe(inDialog('[data-slot="dialog-title"]'));
  // Unpicked, so closing keeps nothing and the empty board's button stays.
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => useWizardStore.getState().chooseNew());
  await settle(() => inDialog<HTMLButtonElement>('[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(500));
  expect(document.activeElement).toBe($('[data-onboard]'));
});

const PR = 'https://github.com/maddec01/lar-apple/pull/14';
const SETUP: SetupAnswers = { itemSource: 'issues', projectOwner: 'maddec01', projectNumber: '', show: 'opted-in', showPicked: false, role: 'iOS app' };
const waiting: OnboardingRepository = { repo: 'maddec01/lar-apple', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-apple', setup: SETUP }, prUrl: PR } };

/** Resumes lar-apple's onboarding from its card, waiting for its PR, has the board finish it with `after`, then presses Go to the board. */
async function finishFromResume(after: BoardData): Promise<void> {
  const before = { ...sample, repos: sample.repos.filter((r) => r.repo !== waiting.repo), items: sample.items.filter((i) => i.repo !== waiting.repo), onboarding: [waiting] };
  serve(before, [project('lar-apple', { onBoard: true })]);
  await mountPage(before);
  const resume = $<HTMLButtonElement>(`[data-onboarding-card="${waiting.repo}"] [data-resume]`)!;
  resume.focus();
  await settle(() => resume.click());
  await settle(() => vi.advanceTimersByTime(50));
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(after));
  await settle(() => button('Go to the board')!.click());
  await settle(() => vi.advanceTimersByTime(500));
}

test('Go to the board, with the Resume that opened the dialog gone, focuses the main heading', async () => {
  await finishFromResume({ ...sample, onboarding: [] });
  expect(document.activeElement).toBe($('.title-bar h1'));
});

test('Go to the board, before the board has read the new repository, focuses the main heading', async () => {
  await finishFromResume({ ...sample, repos: sample.repos.filter((r) => r.repo !== waiting.repo), items: sample.items.filter((i) => i.repo !== waiting.repo), onboarding: [] });
  expect(document.activeElement).toBe($('.title-bar h1'));
});
