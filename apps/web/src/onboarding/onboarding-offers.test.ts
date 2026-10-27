// The board's offer for each T3 project whose repository has .lar-factory.json and isn't on the list, which opens
// the onboarding dialog with that project picked.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, text } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';
import { dialog, empty, project, serve } from './onboarding-support.ts';

const offered = (data: BoardData): BoardData => ({ ...data, onboardingOffers: [{ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub' as const }] });
const offer = () => $('[data-onboarding-offer="maddec01/lar-web"]');

test('the empty board offers to onboard a T3 project whose repository has .lar-factory.json', async () => {
  serve(offered(empty), []);
  await mountPage(offered(empty));
  expect($('[data-empty-state]')).not.toBeNull();
  expect(text(offer())).toContain('lar-web already has a Repository config');
  expect(text(offer())).toContain('maddec01/lar-web has .lar-factory.json on its default branch.');
  expect(text(offer()!.querySelector('button'))).toBe('Onboard lar-web');
});

test('a board with repositories shows the offer above them, and none without offers', async () => {
  serve(offered(sample), []);
  await mountPage(offered(sample));
  expect($$('[data-onboarding-offer]')).toHaveLength(1);
  expect($('.desk')).not.toBeNull();
  await mountPage(sample);
  expect($$('[data-onboarding-offer]')).toHaveLength(0);
});

test('the offer opens the onboarding dialog with its project picked', async () => {
  serve(offered(empty), [project('lar-web', { hasConfig: true }), project('lar-cli')]);
  await mountPage(offered(empty));
  await settle(() => offer()!.querySelector('button')!.click());
  expect(dialog()).not.toBeNull();
  expect(dialog()!.querySelector('[data-choice="lar-web"] [role="radio"]')!.getAttribute('aria-checked')).toBe('true');
});
